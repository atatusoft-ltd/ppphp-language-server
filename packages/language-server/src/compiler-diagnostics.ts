import path from "node:path";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { rangeFromUtf8Offsets } from "./compiler-definition.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DiagnosticSeverity,
  type Diagnostic,
  type DiagnosticRelatedInformation,
} from "vscode-languageserver/node";
import {
  executeCompiler,
  resolveCompiler,
  type CompilerProcessSettings,
} from "./compiler-process.js";

export interface CompilerSettings extends CompilerProcessSettings {
  enabled: boolean;
}

interface CompilerPosition {
  offset?: unknown;
  line?: unknown;
  column?: unknown;
}

interface CompilerLocation {
  file?: unknown;
  range?: {
    start?: CompilerPosition;
    end?: CompilerPosition;
  };
}

interface CompilerDiagnostic {
  code?: unknown;
  severity?: unknown;
  title?: unknown;
  message?: unknown;
  location?: CompilerLocation | null;
  related?: Array<{ message?: unknown; location?: CompilerLocation | null }>;
  help?: unknown;
}

interface CompilerEnvelope {
  version?: unknown;
  diagnostics?: unknown;
}

export interface CompilerRunResult {
  diagnostics: Diagnostic[];
  unavailableReason?: string;
  coverageNote?: string;
}

export async function checkDocument(
  document: TextDocument,
  filePath: string,
  workspaceRoot: string,
  settings: CompilerSettings,
  overlays: readonly TextDocument[],
): Promise<CompilerRunResult> {
  if (!settings.enabled) return { diagnostics: [] };
  try {
    const buffers = overlays.filter((other) => other.uri !== document.uri);
    if (buffers.length >= 32)
      throw new Error("Live diagnostics support at most 32 open project buffers.");
    let total = 0;
    for (const buffer of [document, ...buffers]) {
      const size = Buffer.byteLength(buffer.getText(), "utf8");
      if (size > 2 * 1024 * 1024) throw new Error("A live diagnostic buffer exceeds 2 MiB.");
      total += size;
    }
    if (total > 8 * 1024 * 1024) throw new Error("Live diagnostic buffers exceed 8 MiB in total.");
    const execution = await executeCompiler(
      resolveCompiler(settings.compilerPath, workspaceRoot),
      ["editor:diagnostics", "--working-directory", workspaceRoot, "--format=json"],
      workspaceRoot,
      settings.timeoutMilliseconds,
      JSON.stringify({
        version: 1,
        document: { path: filePath, contents: document.getText(), version: document.version },
        overlays: buffers.map((other) => ({
          path: filePathFromUri(other.uri),
          contents: other.getText(),
        })),
      }),
    );
    if (execution.failure) throw new Error(execution.failure);
    if (!execution.stdout.trim())
      throw new Error(
        "No editor:diagnostics response. Install a compiler supporting unsaved-buffer diagnostics.",
      );
    return parseEditorDiagnostics(execution.stdout, document, filePath, workspaceRoot);
  } catch (error) {
    return {
      diagnostics: [],
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseEditorDiagnostics(
  output: string,
  document: TextDocument,
  filePath: string,
  workspaceRoot: string,
): CompilerRunResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(
      "Invalid editor:diagnostics response. Update the configured ++PHP compiler to a version supporting unsaved-buffer diagnostics.",
    );
  }
  const envelope = parsed as CompilerEnvelope & {
    document?: { path?: unknown; version?: unknown };
    error?: { message?: unknown } | null;
    analysis?: { completeness?: unknown; fullParity?: unknown; supplemental?: unknown };
  };
  if (envelope?.version !== 1) throw new Error("Unsupported editor diagnostics envelope.");
  if (envelope.error)
    throw new Error(asString(envelope.error.message) || "Compiler diagnostics request failed.");
  if (
    envelope.document?.version !== document.version ||
    typeof envelope.document.path !== "string" ||
    path.resolve(workspaceRoot, envelope.document.path) !== path.resolve(filePath)
  ) {
    throw new Error("Compiler diagnostics response does not match the requested document version.");
  }
  if (
    envelope.analysis?.completeness !== "compilerCore" ||
    typeof envelope.analysis.fullParity !== "boolean" ||
    envelope.analysis.supplemental !== false
  )
    throw new Error("Unsupported live analysis coverage contract.");
  return {
    diagnostics: parseCompilerOutput(output, filePath, workspaceRoot, document.getText()),
    coverageNote:
      "Live diagnostics use compiler-core analysis without supplemental PHPStan checks. Run ppphp check for the complete saved-project check." +
      (envelope.analysis.fullParity ? "" : " Required compiler capability coverage is incomplete."),
  };
}

export async function checkFile(
  filePath: string,
  workspaceRoot: string,
  settings: CompilerSettings,
): Promise<CompilerRunResult> {
  if (!settings.enabled) return { diagnostics: [] };
  const compiler = resolveCompiler(settings.compilerPath, workspaceRoot);
  const args = ["check", filePath, "--working-directory", workspaceRoot, "--format=json"];

  const execution = await executeCompiler(
    compiler,
    args,
    workspaceRoot,
    settings.timeoutMilliseconds,
  );
  if (execution.failure) {
    return { diagnostics: [], unavailableReason: execution.failure };
  }
  if (execution.notFound) {
    return {
      diagnostics: [],
      unavailableReason: `Could not find the ++PHP compiler at ${compiler}. Configure ppphp.compiler.path or add ppphp to PATH.`,
    };
  }
  if (!execution.stdout.trim()) {
    return {
      diagnostics: [],
      unavailableReason: execution.stderr.trim() || "The ++PHP compiler produced no JSON output.",
    };
  }

  try {
    return { diagnostics: parseCompilerOutput(execution.stdout, filePath, workspaceRoot) };
  } catch (error) {
    return {
      diagnostics: [],
      unavailableReason: `The ++PHP compiler returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function parseCompilerOutput(
  output: string,
  currentFile: string,
  workspaceRoot: string,
  documentText?: string,
): Diagnostic[] {
  const envelope = JSON.parse(output) as CompilerEnvelope;
  if (envelope.version !== 1 || !Array.isArray(envelope.diagnostics)) {
    throw new Error("unsupported diagnostic envelope");
  }

  return (envelope.diagnostics as CompilerDiagnostic[])
    .filter((diagnostic) => locationMatches(diagnostic.location, currentFile, workspaceRoot))
    .map((diagnostic) => toLspDiagnostic(diagnostic, workspaceRoot, documentText));
}

function toLspDiagnostic(
  diagnostic: CompilerDiagnostic,
  workspaceRoot: string,
  documentText?: string,
): Diagnostic {
  const start = toPosition(diagnostic.location?.range?.start);
  const endCandidate = toPosition(diagnostic.location?.range?.end);
  const end =
    endCandidate.line < start.line ||
    (endCandidate.line === start.line && endCandidate.character < start.character)
      ? start
      : endCandidate;
  const title = asString(diagnostic.title);
  const message = asString(diagnostic.message) || title || "++PHP compiler diagnostic";
  const help = asString(diagnostic.help);
  const relatedInformation = (diagnostic.related ?? [])
    .map((related) => toRelatedInformation(related, workspaceRoot))
    .filter((value): value is DiagnosticRelatedInformation => value !== null);

  return {
    range:
      documentText === undefined || !diagnostic.location
        ? { start, end }
        : rangeFromUtf8Offsets(documentText, {
            start: diagnosticOffset(diagnostic.location?.range?.start?.offset),
            end: diagnosticOffset(diagnostic.location?.range?.end?.offset),
          }),
    severity: toSeverity(asString(diagnostic.severity)),
    code: asString(diagnostic.code) || undefined,
    source: "++PHP",
    message: [
      message,
      title && title !== message ? `Category: ${title}` : "",
      help ? `Help: ${help}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    relatedInformation: relatedInformation.length > 0 ? relatedInformation : undefined,
  };
}

function diagnosticOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid live diagnostic byte offset.");
  }
  return value;
}

function toRelatedInformation(
  related: { message?: unknown; location?: CompilerLocation | null },
  workspaceRoot: string,
): DiagnosticRelatedInformation | null {
  const file = asString(related.location?.file);
  if (!file) return null;
  const filePath = path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file);
  return {
    location: {
      uri: pathToFileURL(filePath).toString(),
      range: {
        start: toPosition(related.location?.range?.start),
        end: toPosition(related.location?.range?.end),
      },
    },
    message: asString(related.message) || "Related location",
  };
}

function locationMatches(
  location: CompilerLocation | null | undefined,
  currentFile: string,
  workspaceRoot: string,
): boolean {
  const reported = asString(location?.file);
  if (!reported) return true;
  const reportedPath = path.isAbsolute(reported) ? reported : path.resolve(workspaceRoot, reported);
  return path.normalize(reportedPath) === path.normalize(currentFile);
}

function toPosition(position: CompilerPosition | undefined): { line: number; character: number } {
  const line = typeof position?.line === "number" ? position.line : 1;
  const column = typeof position?.column === "number" ? position.column : 1;
  return { line: Math.max(0, line - 1), character: Math.max(0, column - 1) };
}

function toSeverity(severity: string): DiagnosticSeverity {
  switch (severity.toLowerCase()) {
    case "warning":
      return DiagnosticSeverity.Warning;
    case "note":
    case "information":
    case "info":
      return DiagnosticSeverity.Information;
    case "hint":
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Error;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function filePathFromUri(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}
