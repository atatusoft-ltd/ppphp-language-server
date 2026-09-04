import path from "node:path";
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
): Diagnostic[] {
  const envelope = JSON.parse(output) as CompilerEnvelope;
  if (envelope.version !== 1 || !Array.isArray(envelope.diagnostics)) {
    throw new Error("unsupported diagnostic envelope");
  }

  return (envelope.diagnostics as CompilerDiagnostic[])
    .filter((diagnostic) => locationMatches(diagnostic.location, currentFile, workspaceRoot))
    .map((diagnostic) => toLspDiagnostic(diagnostic, workspaceRoot));
}

function toLspDiagnostic(diagnostic: CompilerDiagnostic, workspaceRoot: string): Diagnostic {
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
    range: { start, end },
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
