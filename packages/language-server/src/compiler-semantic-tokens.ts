import type { TextDocument } from "vscode-languageserver-textdocument";
import { rangeFromUtf8Offsets } from "./compiler-definition.js";
import {
  executeCompiler,
  resolveCompiler,
  type CompilerProcessSettings,
} from "./compiler-process.js";
import {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  type SemanticTokenClassification,
  type SemanticTokenModifier,
  type SemanticTokenType,
} from "./semantic-tokens.js";

interface CompilerOffsetPosition {
  offset?: unknown;
}

interface CompilerRange {
  start?: CompilerOffsetPosition;
  end?: CompilerOffsetPosition;
}

interface CompilerSemanticToken {
  type?: unknown;
  modifiers?: unknown;
  range?: CompilerRange;
}

interface CompilerSemanticTokensEnvelope {
  version?: unknown;
  tokens?: unknown;
  error?: { code?: unknown; message?: unknown } | null;
}

export interface CompilerSemanticTokensResult {
  tokens: SemanticTokenClassification[];
  unavailableReason?: string;
}

export async function classifySemanticTokens(
  document: TextDocument,
  filePath: string,
  workspaceRoot: string,
  settings: CompilerProcessSettings,
): Promise<CompilerSemanticTokensResult> {
  const compiler = resolveCompiler(settings.compilerPath, workspaceRoot);
  const execution = await executeCompiler(
    compiler,
    ["editor:semantic-tokens", "--working-directory", workspaceRoot, "--format=json"],
    workspaceRoot,
    settings.timeoutMilliseconds,
    buildSemanticTokensRequest(document, filePath),
  );

  if (execution.failure) {
    return { tokens: [], unavailableReason: execution.failure };
  }

  if (execution.notFound) {
    return {
      tokens: [],
      unavailableReason: `Could not find the ++PHP compiler at ${compiler}. Configure ppphp.compiler.path or add ppphp to PATH.`,
    };
  }

  if (!execution.stdout.trim()) {
    return {
      tokens: [],
      unavailableReason:
        execution.stderr.trim() || "The ++PHP compiler produced no semantic tokens response.",
    };
  }

  try {
    return { tokens: parseCompilerSemanticTokens(execution.stdout, document.getText()) };
  } catch (error) {
    return {
      tokens: [],
      unavailableReason: `The ++PHP compiler returned an invalid semantic tokens response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function buildSemanticTokensRequest(document: TextDocument, filePath: string): string {
  return JSON.stringify({
    version: 1,
    document: {
      path: filePath,
      contents: document.getText(),
    },
  });
}

export function parseCompilerSemanticTokens(
  output: string,
  documentText: string,
): SemanticTokenClassification[] {
  const envelope = JSON.parse(output) as CompilerSemanticTokensEnvelope;

  if (envelope.version !== 1) {
    throw new Error("unsupported semantic tokens envelope");
  }

  if (envelope.error !== null && envelope.error !== undefined) {
    const message =
      typeof envelope.error.message === "string" ? envelope.error.message : "unknown error";
    throw new Error(message);
  }

  if (!Array.isArray(envelope.tokens)) {
    throw new Error("semantic tokens are missing");
  }

  const byteLength = Buffer.byteLength(documentText, "utf8");
  const tokens = (envelope.tokens as CompilerSemanticToken[]).map((token) => {
    const type = parseType(token.type);
    const modifiers = parseModifiers(token.modifiers);
    const offsets = parseRange(token.range, byteLength);
    const range = rangeFromUtf8Offsets(documentText, offsets);

    if (range.start.line !== range.end.line || range.end.character <= range.start.character) {
      throw new Error("semantic token range must be non-empty and contained on one line");
    }

    return { type, modifiers, range };
  });

  return tokens.sort(compareTokens);
}

function parseType(type: unknown): SemanticTokenType {
  if (typeof type !== "string" || !SEMANTIC_TOKEN_TYPES.includes(type as SemanticTokenType)) {
    throw new Error("semantic token type is unsupported");
  }

  return type as SemanticTokenType;
}

function parseModifiers(modifiers: unknown): SemanticTokenModifier[] {
  if (
    !Array.isArray(modifiers) ||
    !modifiers.every(
      (modifier) =>
        typeof modifier === "string" &&
        SEMANTIC_TOKEN_MODIFIERS.includes(modifier as SemanticTokenModifier),
    )
  ) {
    throw new Error("semantic token modifiers are unsupported");
  }

  return [...new Set(modifiers as SemanticTokenModifier[])];
}

function parseRange(
  range: CompilerRange | undefined,
  byteLength: number,
): { start: number; end: number } {
  const start = range?.start?.offset;
  const end = range?.end?.offset;

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    (start as number) < 0 ||
    (end as number) <= (start as number) ||
    (end as number) > byteLength
  ) {
    throw new Error("semantic token range is invalid");
  }

  return { start: start as number, end: end as number };
}

function compareTokens(
  left: Pick<SemanticTokenClassification, "range">,
  right: Pick<SemanticTokenClassification, "range">,
): number {
  return (
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.range.end.character - right.range.end.character
  );
}
