import { SemanticTokensBuilder, type SemanticTokens } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import grammar from "../../../res/textmate/ppphp/syntaxes/ppphp.tmLanguage.json";
import { maskNonCode } from "./language-features.js";

export const SEMANTIC_TOKEN_LEGEND = {
  tokenTypes: ["keyword", "type"],
  tokenModifiers: [],
};

type SemanticRole = "keyword" | "type";

interface TextMateRule {
  begin?: string;
  match?: string;
  patterns?: TextMateRule[];
}

interface ClassifiedRange {
  offset: number;
  length: number;
  role: SemanticRole;
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
const nonTypeNames = new Set(["readonly", "val", "var"]);

export function semanticTokens(document: TextDocument): SemanticTokens {
  const ranges = classify(document.getText());
  const builder = new SemanticTokensBuilder();

  for (const range of ranges) {
    const start = document.positionAt(range.offset);
    builder.push(
      start.line,
      start.character,
      range.length,
      SEMANTIC_TOKEN_LEGEND.tokenTypes.indexOf(range.role),
      0,
    );
  }

  return builder.build();
}

function classify(source: string): ClassifiedRange[] {
  const searchable = maskNonCode(source);
  const ranges = new Map<string, ClassifiedRange>();
  const add = (offset: number, length: number, role: SemanticRole): void => {
    ranges.set(`${offset}:${length}`, { offset, length, role });
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
  add: (offset: number, length: number, role: SemanticRole) => void,
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
