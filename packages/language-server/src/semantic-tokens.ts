import { SemanticTokensBuilder, type Range, type SemanticTokens } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import grammar from "../../../res/textmate/ppphp/syntaxes/ppphp.tmLanguage.json";
import { maskNonCode } from "./language-features.js";

export const SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "class",
  "enum",
  "interface",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "function",
  "method",
  "keyword",
  "type",
  "decorator",
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = [
  "declaration",
  "readonly",
  "static",
  "abstract",
  "defaultLibrary",
] as const;

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];
export type SemanticTokenModifier = (typeof SEMANTIC_TOKEN_MODIFIERS)[number];

export interface SemanticTokenClassification {
  range: Range;
  type: SemanticTokenType;
  modifiers: SemanticTokenModifier[];
}

export const SEMANTIC_TOKEN_LEGEND = {
  tokenTypes: [...SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
};

type FallbackRole = "keyword" | "type";

interface TextMateRule {
  begin?: string;
  match?: string;
  patterns?: TextMateRule[];
}

interface OffsetClassification {
  offset: number;
  length: number;
  type: SemanticTokenType;
  modifiers: SemanticTokenModifier[];
}

const repository = grammar.repository as Record<string, TextMateRule>;
const typedBindingPattern = requirePattern(
  repository["typed-binding"]?.begin,
  "typed-binding.begin",
);
const throwsPattern = requirePattern(repository["throws-clause"]?.begin, "throws-clause.begin");
const whenPattern = requirePattern(
  repository["when-expression"]?.patterns?.[0]?.match,
  "when-expression.patterns[0].match",
);
const typeNamePattern = /\\?[A-Za-z_][A-Za-z0-9_\\]*/gu;
const nonTypeNames = new Set([
  "array",
  "bool",
  "callable",
  "false",
  "float",
  "int",
  "iterable",
  "mixed",
  "never",
  "null",
  "object",
  "parent",
  "readonly",
  "self",
  "static",
  "string",
  "true",
  "val",
  "var",
  "void",
]);

/**
 * Merge compiler-owned PHP/++PHP semantic roles with the small grammar-derived
 * fallback. Compiler tokens win; the fallback keeps extension coloring useful
 * while the compiler is missing or the current document cannot be parsed.
 */
export function semanticTokens(
  document: TextDocument,
  compilerTokens: SemanticTokenClassification[] = [],
): SemanticTokens {
  // Plain variable usages are already fully classified by each host's PHP
  // lexer. Re-emitting them would erase more precise scopes such as `$this`
  // and PHP superglobals without adding semantic information.
  const classified = compilerTokens
    .filter((token) => token.type !== "variable" || token.modifiers.length > 0)
    .map((token) => toOffsetClassification(document, token));

  for (const fallback of classifyFallback(document.getText())) {
    if (!classified.some((candidate) => overlaps(candidate, fallback))) {
      classified.push(fallback);
    }
  }

  classified.sort((left, right) => left.offset - right.offset || left.length - right.length);
  const builder = new SemanticTokensBuilder();

  for (const token of classified) {
    const start = document.positionAt(token.offset);
    const type = SEMANTIC_TOKEN_LEGEND.tokenTypes.indexOf(token.type);
    const modifiers = token.modifiers.reduce((mask, modifier) => {
      const index = SEMANTIC_TOKEN_LEGEND.tokenModifiers.indexOf(modifier);
      return index < 0 ? mask : mask | (1 << index);
    }, 0);

    builder.push(start.line, start.character, token.length, type, modifiers);
  }

  return builder.build();
}

function toOffsetClassification(
  document: TextDocument,
  token: SemanticTokenClassification,
): OffsetClassification {
  const offset = document.offsetAt(token.range.start);
  const end = document.offsetAt(token.range.end);

  return {
    offset,
    length: end - offset,
    type: token.type,
    modifiers: token.modifiers,
  };
}

function overlaps(left: OffsetClassification, right: OffsetClassification): boolean {
  return left.offset < right.offset + right.length && right.offset < left.offset + left.length;
}

function classifyFallback(source: string): OffsetClassification[] {
  const searchable = maskNonCode(source);
  const ranges = new Map<string, OffsetClassification>();
  const add = (offset: number, length: number, type: FallbackRole): void => {
    ranges.set(`${offset}:${length}`, { offset, length, type, modifiers: [] });
  };

  for (const match of matches(searchable, whenPattern)) {
    add(match.index, match.text.length, "keyword");
  }

  for (const match of matches(searchable, throwsPattern)) {
    add(match.index, match.text.length, "keyword");
    const clauseStart = match.index + match.text.length;
    const terminator = searchable.slice(clauseStart).search(/[;{]/u);
    if (terminator >= 0) {
      addTypeNames(searchable, clauseStart, clauseStart + terminator, add);
    }
  }

  for (const match of matches(searchable, typedBindingPattern)) {
    const variableOffset = searchable.indexOf("$", match.index);
    if (variableOffset < 0) continue;

    const prefix = searchable.slice(match.index, variableOffset);
    const readonly = /\breadonly\b/u.exec(prefix);
    if (readonly?.index !== undefined) {
      add(match.index + readonly.index, readonly[0].length, "keyword");
    }
    addTypeNames(searchable, match.index, variableOffset, add);
  }

  return [...ranges.values()].sort((left, right) => left.offset - right.offset);
}

function addTypeNames(
  source: string,
  start: number,
  end: number,
  add: (offset: number, length: number, role: FallbackRole) => void,
): void {
  for (const match of source.slice(start, end).matchAll(typeNamePattern)) {
    if (match.index === undefined) continue;
    const name = match[0].replace(/^\\/u, "").toLowerCase();
    if (!nonTypeNames.has(name)) add(start + match.index, match[0].length, "type");
  }
}

function matches(source: string, pattern: string): Array<{ index: number; text: string }> {
  return [...source.matchAll(new RegExp(pattern, "gu"))].flatMap((match) =>
    match.index === undefined ? [] : [{ index: match.index, text: match[0] }],
  );
}

function requirePattern(pattern: string | undefined, path: string): string {
  if (pattern === undefined) {
    throw new Error(`Canonical TextMate grammar is missing ${path}`);
  }
  return pattern;
}
