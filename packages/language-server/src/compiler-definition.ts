import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DefinitionLink, Position, Range } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  executeCompiler,
  resolveCompiler,
  type CompilerProcessSettings,
} from "./compiler-process.js";

interface CompilerOffsetPosition {
  offset?: unknown;
}

interface CompilerRange {
  start?: CompilerOffsetPosition;
  end?: CompilerOffsetPosition;
}

interface CompilerDefinitionEnvelope {
  version?: unknown;
  definition?: {
    symbolId?: unknown;
    kind?: unknown;
    location?: {
      file?: unknown;
      range?: CompilerRange;
      selectionRange?: CompilerRange;
    };
  } | null;
  error?: { code?: unknown; message?: unknown } | null;
}

export interface CompilerSymbolDefinition {
  symbolId: string;
  kind: string;
  filePath: string;
  range: { start: number; end: number };
  selectionRange: { start: number; end: number };
}

export interface CompilerSymbolResult {
  symbol: CompilerSymbolDefinition | null;
  unavailableReason?: string;
}

export interface CompilerDefinitionResult {
  definition: DefinitionLink[] | null;
  unavailableReason?: string;
}

export async function findDefinitionAt(
  document: TextDocument,
  position: Position,
  filePath: string,
  workspaceRoot: string,
  settings: CompilerProcessSettings,
): Promise<CompilerDefinitionResult> {
  const result = await resolveCompilerSymbolAt(
    document,
    position,
    filePath,
    workspaceRoot,
    settings,
  );

  if (!result.symbol) {
    return {
      definition: null,
      unavailableReason: result.unavailableReason,
    };
  }

  try {
    const targetUri = pathToFileURL(result.symbol.filePath).toString();
    const targetText =
      path.normalize(result.symbol.filePath) === path.normalize(filePath)
        ? document.getText()
        : await readFile(result.symbol.filePath, "utf8");

    return {
      definition: [
        {
          targetUri,
          targetRange: rangeFromUtf8Offsets(targetText, result.symbol.range),
          targetSelectionRange: rangeFromUtf8Offsets(targetText, result.symbol.selectionRange),
        },
      ],
    };
  } catch (error) {
    return {
      definition: null,
      unavailableReason: `The ++PHP compiler returned an invalid definition response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function resolveCompilerSymbolAt(
  document: TextDocument,
  position: Position,
  filePath: string,
  workspaceRoot: string,
  settings: CompilerProcessSettings,
): Promise<CompilerSymbolResult> {
  const compiler = resolveCompiler(settings.compilerPath, workspaceRoot);
  const request = buildDefinitionRequest(document, position, filePath);

  return resolveCompilerSymbolAtPosition(workspaceRoot, settings, compiler, request);
}

export function buildDefinitionRequest(
  document: TextDocument,
  position: Position,
  filePath: string,
): string {
  return JSON.stringify({
    version: 1,
    document: {
      path: filePath,
      contents: document.getText(),
    },
    position: {
      offset: utf8OffsetAt(document, document.offsetAt(position)),
    },
  });
}

async function resolveCompilerSymbolAtPosition(
  workspaceRoot: string,
  settings: CompilerProcessSettings,
  compiler: string,
  request: string,
): Promise<CompilerSymbolResult> {
  const execution = await executeCompiler(
    compiler,
    ["editor:definition", "--working-directory", workspaceRoot, "--format=json"],
    workspaceRoot,
    settings.timeoutMilliseconds,
    request,
  );

  if (execution.notFound) {
    return {
      symbol: null,
      unavailableReason: `Could not find the ++PHP compiler at ${compiler}. Configure ppphp.compiler.path or add ppphp to PATH.`,
    };
  }

  if (!execution.stdout.trim()) {
    return {
      symbol: null,
      unavailableReason:
        execution.stderr.trim() || "The ++PHP compiler produced no definition response.",
    };
  }

  try {
    return { symbol: parseCompilerDefinition(execution.stdout, workspaceRoot) };
  } catch (error) {
    return {
      symbol: null,
      unavailableReason: `The ++PHP compiler returned an invalid definition response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function parseCompilerDefinition(
  output: string,
  workspaceRoot: string,
): CompilerSymbolDefinition | null {
  const envelope = JSON.parse(output) as CompilerDefinitionEnvelope;

  if (envelope.version !== 1) {
    throw new Error("unsupported definition envelope");
  }

  if (envelope.error !== null && envelope.error !== undefined) {
    const message =
      typeof envelope.error.message === "string" ? envelope.error.message : "unknown error";
    throw new Error(message);
  }

  if (envelope.definition === null) return null;
  if (
    !envelope.definition ||
    typeof envelope.definition.symbolId !== "string" ||
    typeof envelope.definition.kind !== "string" ||
    typeof envelope.definition.location?.file !== "string"
  ) {
    throw new Error("definition location is missing");
  }

  const file = envelope.definition.location.file;

  return {
    symbolId: envelope.definition.symbolId,
    kind: envelope.definition.kind,
    filePath: path.normalize(path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file)),
    range: parseRange(envelope.definition.location.range),
    selectionRange: parseRange(envelope.definition.location.selectionRange),
  };
}

export function rangeFromUtf8Offsets(text: string, offsets: { start: number; end: number }): Range {
  if (offsets.end < offsets.start) throw new Error("definition range is reversed");

  return {
    start: positionAtUtf8Offset(text, offsets.start),
    end: positionAtUtf8Offset(text, offsets.end),
  };
}

export function positionAtUtf8Offset(text: string, byteOffset: number): Position {
  const target = Math.max(0, Math.min(byteOffset, Buffer.byteLength(text, "utf8")));
  let bytes = 0;
  let utf16Offset = 0;

  for (const character of text) {
    const next = bytes + Buffer.byteLength(character, "utf8");
    if (next > target) break;
    bytes = next;
    utf16Offset += character.length;
  }

  return positionAtUtf16Offset(text, utf16Offset);
}

export function utf8OffsetAt(document: TextDocument, utf16Offset: number): number {
  return Buffer.byteLength(document.getText().slice(0, utf16Offset), "utf8");
}

function parseRange(range: CompilerRange | undefined): { start: number; end: number } {
  const start = range?.start?.offset;
  const end = range?.end?.offset;

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    (start as number) < 0 ||
    (end as number) < 0
  ) {
    throw new Error("definition range is invalid");
  }

  return { start: start as number, end: end as number };
}

function positionAtUtf16Offset(text: string, offset: number): Position {
  const document = {
    getText: (): string => text,
  };
  const prefix = document.getText().slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);

  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  };
}
