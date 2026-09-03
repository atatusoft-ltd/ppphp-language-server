import {
  CodeActionKind,
  type CodeAction,
  type Range,
  type TextEdit,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { maskNonCode } from "./language-features.js";
import { parseTypeDeclarations, type TypeCatalogEntry } from "./type-catalog.js";

interface ImportScope {
  namespace: string;
  anchor: number;
  start: number;
  end: number;
}

interface ImportedType {
  fqn: string;
  alias: string;
}

interface ImportStatement {
  start: number;
  end: number;
  types: ImportedType[];
}

export interface TypeImportPlan {
  reference: string;
  importEdit?: TextEdit;
}

export type TypeImportPlanner = (entry: TypeCatalogEntry) => TypeImportPlan | null;

const IDENTIFIER = "[A-Z_\\u0080-\\u{10ffff}][A-Z0-9_\\u0080-\\u{10ffff}]*";
const QUALIFIED_NAME = new RegExp(`^${IDENTIFIER}(?:\\\\${IDENTIFIER})*$`, "iu");
const FULLY_QUALIFIED_NAME = new RegExp(`\\\\(?:${IDENTIFIER}\\\\)+${IDENTIFIER}`, "giu");
const NAMESPACE = new RegExp(
  `\\bnamespace(?:\\s+(${IDENTIFIER}(?:\\\\${IDENTIFIER})*))?\\s*([;{])`,
  "giu",
);

export function typeImportCodeActionsAt(
  document: TextDocument,
  range: Range,
  catalog: readonly TypeCatalogEntry[],
): CodeAction[] {
  const source = document.getText();
  const masked = maskNonCode(source);
  const requestedStart = document.offsetAt(range.start);
  const requestedEnd = document.offsetAt(range.end);
  const match = [...masked.matchAll(FULLY_QUALIFIED_NAME)].find((candidate) => {
    const start = candidate.index ?? -1;
    const end = start + candidate[0].length;
    const isAbsolute = start === 0 || !isNameCharacter(masked[start - 1] ?? "");
    return (
      isAbsolute &&
      (requestedStart === requestedEnd
        ? start <= requestedStart && requestedStart <= end
        : start < requestedEnd && requestedStart < end)
    );
  });
  const start = match?.index;
  if (!match || start === undefined) return [];

  const fqn = match[0].slice(1);
  const entry = catalog.find((candidate) => equalName(candidate.fqn, fqn));
  if (!entry) return [];

  const plan = createTypeImportPlanner(document, start)?.(entry);
  if (!plan) return [];

  const edits: TextEdit[] = [
    {
      range: {
        start: document.positionAt(start),
        end: document.positionAt(start + match[0].length),
      },
      newText: plan.reference,
    },
  ];
  if (plan.importEdit) edits.push(plan.importEdit);

  return [
    {
      title: `Use import for ${entry.fqn}`,
      kind: CodeActionKind.QuickFix,
      isPreferred: true,
      edit: { changes: { [document.uri]: edits } },
    },
  ];
}

export function planTypeImportAt(
  document: TextDocument,
  offset: number,
  entry: TypeCatalogEntry,
): TypeImportPlan | null {
  return createTypeImportPlanner(document, offset)?.(entry) ?? null;
}

export function createTypeImportPlanner(
  document: TextDocument,
  offset: number,
): TypeImportPlanner | null {
  const source = document.getText();
  const masked = maskNonCode(source);
  const scope = importScopeAt(masked, offset);
  if (!scope || isImportDeclarationLine(masked, offset)) return null;
  const statements = importStatements(masked, scope);
  if (statements.some((statement) => offset >= statement.start && offset < statement.end)) {
    return null;
  }
  const imported = statements.flatMap((statement) => statement.types);
  const localNames = new Set(
    parseTypeDeclarations(source, "project")
      .filter((type) => equalName(type.namespace, scope.namespace))
      .map((type) => `${type.name.toLowerCase()}\0${type.fqn.toLowerCase()}`),
  );
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";

  return (entry) =>
    planTypeImport(document, entry, scope, statements, imported, localNames, lineEnding);
}

function planTypeImport(
  document: TextDocument,
  entry: TypeCatalogEntry,
  scope: ImportScope,
  statements: readonly ImportStatement[],
  imported: readonly ImportedType[],
  localNames: ReadonlySet<string>,
  lineEnding: string,
): TypeImportPlan | null {
  const existing = imported.find((type) => equalName(type.fqn, entry.fqn));
  if (existing) return { reference: existing.alias };

  if (equalName(scope.namespace, entry.namespace)) return { reference: entry.name };

  const collision = imported.some(
    (type) => equalName(type.alias, entry.name) && !equalName(type.fqn, entry.fqn),
  );
  const localCollision = [...localNames].some(
    (type) =>
      type.startsWith(`${entry.name.toLowerCase()}\0`) &&
      type !== `${entry.name.toLowerCase()}\0${entry.fqn.toLowerCase()}`,
  );
  if (collision || localCollision) return null;

  const lastStatement = statements.at(-1);
  const insertionOffset = lastStatement?.end ?? scope.anchor;
  const newText = lastStatement
    ? `${lineEnding}use ${entry.fqn};`
    : `${lineEnding}${lineEnding}use ${entry.fqn};`;

  return {
    reference: entry.name,
    importEdit: {
      range: {
        start: document.positionAt(insertionOffset),
        end: document.positionAt(insertionOffset),
      },
      newText,
    },
  };
}

function importScopeAt(source: string, offset: number): ImportScope | null {
  const declarations = [...source.matchAll(NAMESPACE)].map((match) => {
    const start = match.index ?? 0;
    const delimiter = match[2] ?? ";";
    const delimiterStart = start + match[0].lastIndexOf(delimiter);
    return {
      namespace: match[1] ?? "",
      start,
      anchor: delimiterStart + 1,
      delimiter,
      closing: delimiter === "{" ? matchingBrace(source, delimiterStart) : undefined,
    };
  });

  for (let index = declarations.length - 1; index >= 0; index -= 1) {
    const declaration = declarations[index];
    if (!declaration) continue;
    const end =
      declaration.delimiter === "{"
        ? declaration.closing
        : (declarations[index + 1]?.start ?? source.length);
    if (end !== undefined && offset >= declaration.anchor && offset < end) {
      return {
        namespace: declaration.namespace,
        anchor: declaration.anchor,
        start: declaration.anchor,
        end,
      };
    }
  }

  const openTag = source.indexOf("<?php");
  const end = declarations[0]?.start ?? source.length;
  if (openTag < 0 || offset < openTag + 5 || offset >= end) return null;
  return { namespace: "", anchor: openTag + 5, start: openTag + 5, end };
}

function matchingBrace(source: string, opening: number): number | undefined {
  let depth = 0;
  for (let offset = opening; offset < source.length; offset += 1) {
    if (source[offset] === "{") depth += 1;
    if (source[offset] !== "}") continue;
    depth -= 1;
    if (depth === 0) return offset;
  }
  return undefined;
}

function importStatements(source: string, scope: ImportScope): ImportStatement[] {
  const statements: ImportStatement[] = [];
  const tokens = source.slice(scope.start, scope.end).matchAll(/\buse\b|[{}]/giu);
  let depth = 0;

  for (const token of tokens) {
    const start = scope.start + (token.index ?? 0);
    if (token[0] === "{") {
      depth += 1;
      continue;
    }
    if (token[0] === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || !beginsStatement(source, scope.start, start)) continue;

    const end = source.indexOf(";", start + token[0].length);
    if (end < 0 || end >= scope.end) continue;
    statements.push({
      start,
      end: end + 1,
      types: importedTypes(source.slice(start + token[0].length, end)),
    });
  }
  return statements;
}

function importedTypes(body: string): ImportedType[] {
  const value = body.trim();
  if (/^(?:function|const)\b/iu.test(value)) return [];

  const opening = value.indexOf("{");
  const closing = value.lastIndexOf("}");
  if (opening >= 0 && closing > opening) {
    const prefix = value.slice(0, opening).trim().replace(/\\+$/u, "");
    return value
      .slice(opening + 1, closing)
      .split(",")
      .map((part) => importedType(part, prefix))
      .filter((type): type is ImportedType => type !== null);
  }

  return value
    .split(",")
    .map((part) => importedType(part))
    .filter((type): type is ImportedType => type !== null);
}

function importedType(part: string, prefix = ""): ImportedType | null {
  const value = part.trim();
  if (/^(?:function|const)\b/iu.test(value)) return null;
  const match = /^(.*?)(?:\s+as\s+([A-Z_\u0080-\u{10ffff}][A-Z0-9_\u0080-\u{10ffff}]*))?$/iu.exec(
    value,
  );
  const path = match?.[1]?.trim().replace(/^\\+/u, "");
  if (!path) return null;
  const fqn = prefix === "" ? path : `${prefix}\\${path}`;
  if (!QUALIFIED_NAME.test(fqn)) return null;
  return { fqn, alias: match?.[2] ?? fqn.split("\\").at(-1) ?? fqn };
}

function isImportDeclarationLine(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  return /^\s*(?:namespace|use)\b/iu.test(source.slice(lineStart, offset));
}

function beginsStatement(source: string, scopeStart: number, offset: number): boolean {
  for (let index = offset - 1; index >= scopeStart; index -= 1) {
    const character = source[index];
    if (character && !/\s/u.test(character)) return character === ";" || character === "}";
  }
  return true;
}

function isNameCharacter(character: string): boolean {
  return character === "\\" || /[A-Z0-9_\u0080-\u{10ffff}]/iu.test(character);
}

function equalName(left: string, right: string): boolean {
  return left.replace(/^\\/u, "").toLowerCase() === right.replace(/^\\/u, "").toLowerCase();
}
