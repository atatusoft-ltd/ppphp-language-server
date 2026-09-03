import {
  CodeActionKind,
  type CodeAction,
  type Range,
  type TextEdit,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { maskNonCode } from "./language-features.js";
import { parseTypeDeclarations, type TypeCatalogEntry } from "./type-catalog.js";
import type { ImportSorting } from "./server-settings.js";

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
  appendOffset: number;
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
  importSorting: ImportSorting = "alphabetic",
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
  if (!isTypeReferenceAt(masked, start, start + match[0].length)) return [];

  const fqn = match[0].slice(1);
  const entry = catalog.find((candidate) => equalName(candidate.fqn, fqn));
  if (!entry) return [];

  const plan = createTypeImportPlanner(document, start, importSorting)?.(entry);
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
  importSorting: ImportSorting = "alphabetic",
): TypeImportPlan | null {
  return createTypeImportPlanner(document, offset, importSorting)?.(entry) ?? null;
}

export function createTypeImportPlanner(
  document: TextDocument,
  offset: number,
  importSorting: ImportSorting = "alphabetic",
): TypeImportPlanner | null {
  const source = document.getText();
  const masked = maskNonCode(source);
  const scope = importScopeAt(masked, offset);
  if (!scope || isImportDeclarationLine(masked, offset)) return null;
  const importAnchor = leadingDeclareAnchor(masked, scope);
  const statements = importStatements(masked, scope);
  if (statements.some((statement) => offset >= statement.start && offset < statement.end)) {
    return null;
  }
  const imported = statements.flatMap((statement) => statement.types);
  const referencedLocalTypes = unqualifiedTypeReferences(masked, scope, offset);
  const localNames = new Set(
    parseTypeDeclarations(source, "project")
      .filter((type) => equalName(type.namespace, scope.namespace))
      .map((type) => `${type.name.toLowerCase()}\0${type.fqn.toLowerCase()}`),
  );
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";

  return (entry) =>
    planTypeImport(
      document,
      entry,
      scope,
      importAnchor,
      statements,
      imported,
      referencedLocalTypes,
      localNames,
      source,
      lineEnding,
      importSorting,
    );
}

function planTypeImport(
  document: TextDocument,
  entry: TypeCatalogEntry,
  scope: ImportScope,
  importAnchor: number,
  statements: readonly ImportStatement[],
  imported: readonly ImportedType[],
  referencedLocalTypes: ReadonlySet<string>,
  localNames: ReadonlySet<string>,
  source: string,
  lineEnding: string,
  importSorting: ImportSorting,
): TypeImportPlan | null {
  const existing = imported.find((type) => equalName(type.fqn, entry.fqn));
  if (existing) return { reference: existing.alias };

  const collision = imported.some(
    (type) => equalName(type.alias, entry.name) && !equalName(type.fqn, entry.fqn),
  );
  if (equalName(scope.namespace, entry.namespace)) {
    return collision ? null : { reference: entry.name };
  }

  const localCollision = [...localNames].some(
    (type) =>
      type.startsWith(`${entry.name.toLowerCase()}\0`) &&
      type !== `${entry.name.toLowerCase()}\0${entry.fqn.toLowerCase()}`,
  );
  if (collision || localCollision || referencedLocalTypes.has(entry.name.toLowerCase()))
    return null;

  const sortedBeforeIndex =
    importSorting === "none"
      ? -1
      : statements.findIndex((statement) => {
          const importedFqn = statement.types[0]?.fqn;
          return importedFqn ? compareImports(entry.fqn, importedFqn, importSorting) < 0 : false;
        });
  const sortedBefore =
    sortedBeforeIndex >= 0 &&
    hasOnlyWhitespaceBefore(source, importAnchor, statements, sortedBeforeIndex)
      ? statements[sortedBeforeIndex]
      : undefined;
  const lastStatement = statements.at(-1);
  const insertionOffset = sortedBefore?.start ?? lastStatement?.appendOffset ?? importAnchor;
  const indentation = lineIndentationAt(source, sortedBefore?.start ?? lastStatement?.start);
  const newText = sortedBefore
    ? `use ${entry.fqn};${lineEnding}${indentation}`
    : lastStatement
      ? lastStatement.appendOffset > lastStatement.end
        ? `${indentation}use ${entry.fqn};${lineEnding}`
        : `${lineEnding}${indentation}use ${entry.fqn};`
      : `${lineEnding}${lineEnding}${namespaceBodyIndentation(source, scope)}use ${entry.fqn};`;

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

function hasOnlyWhitespaceBefore(
  source: string,
  importAnchor: number,
  statements: readonly ImportStatement[],
  index: number,
): boolean {
  const statement = statements[index];
  if (!statement) return false;
  const previousEnd = index > 0 ? statements[index - 1]?.end : importAnchor;
  return previousEnd !== undefined && /^\s*$/u.test(source.slice(previousEnd, statement.start));
}

function leadingDeclareAnchor(source: string, scope: ImportScope): number {
  const declarations = /^(?:\s*declare\s*\([^;{}]*\)\s*;)+/iu.exec(
    source.slice(scope.anchor, scope.end),
  );
  return scope.anchor + (declarations?.[0].length ?? 0);
}

function lineIndentationAt(source: string, offset: number | undefined): string {
  if (offset === undefined) return "";
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const indentation = source.slice(lineStart, offset);
  return /^\s*$/u.test(indentation) ? indentation : "";
}

function namespaceBodyIndentation(source: string, scope: ImportScope): string {
  if (source[scope.anchor - 1] !== "{") return "";
  const body = source.slice(scope.anchor, scope.end);
  const firstContent = /(?:^|\r?\n)([\t ]*)\S/u.exec(body);
  return firstContent?.[1] ?? "";
}

function compareImports(
  left: string,
  right: string,
  sorting: Exclude<ImportSorting, "none">,
): number {
  if (sorting === "length") {
    const length = left.length - right.length;
    if (length !== 0) return length;
  }
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
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
      appendOffset: importAppendOffset(source, end + 1, scope.end),
      types: importedTypes(source.slice(start + token[0].length, end)),
    });
  }
  return statements;
}

function importAppendOffset(source: string, statementEnd: number, scopeEnd: number): number {
  const lineFeed = source.indexOf("\n", statementEnd);
  const lineEnd = lineFeed >= 0 && lineFeed < scopeEnd ? lineFeed + 1 : scopeEnd;
  const contentEnd = lineFeed >= 0 && lineFeed < scopeEnd ? lineFeed : scopeEnd;
  return /^[\t ]*\r?$/u.test(source.slice(statementEnd, contentEnd)) ? lineEnd : statementEnd;
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

function isTypeReferenceAt(source: string, start: number, end: number): boolean {
  const before = source.slice(0, start);
  const after = source.slice(end);
  if (/^\s*::/u.test(after)) return true;

  const typeName = `(?:\\\\)?${IDENTIFIER}(?:\\\\${IDENTIFIER})*`;
  const declaredVariable = new RegExp(
    `^(?:\\s*[|&]\\s*\\??${typeName})*\\s+\\$${IDENTIFIER}`,
    "iu",
  );
  if (declaredVariable.test(after)) return true;
  if (/\b(?:new|instanceof)\s*$/iu.test(before)) return true;

  const statementStart = Math.max(
    before.lastIndexOf(";"),
    before.lastIndexOf("{"),
    before.lastIndexOf("}"),
  );
  const statement = before.slice(statementStart + 1);
  if (/\b(?:extends|implements)\b[^{};]*$/iu.test(statement)) return true;

  const openParenthesis = before.lastIndexOf("(");
  if (openParenthesis >= 0 && /\bcatch\s*$/iu.test(before.slice(0, openParenthesis))) {
    const precedingTypes = before.slice(openParenthesis + 1);
    const catchPrefix = new RegExp(`^\\s*(?:${typeName}\\s*\\|\\s*)*$`, "iu");
    if (catchPrefix.test(precedingTypes)) return true;
  }

  const returnType = new RegExp(
    `\\b(?:function|fn)\\b[^{};]*\\)\\s*:\\s*(?:\\??${typeName}\\s*[|&]\\s*)*$`,
    "iu",
  );
  if (returnType.test(statement)) return true;

  return isAttributeNamePosition(before);
}

function isAttributeNamePosition(source: string): boolean {
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let candidateStart = -1;

  for (let index = 0; index < source.length; index += 1) {
    if (bracketDepth === 0) {
      if (source[index] === "#" && source[index + 1] === "[") {
        bracketDepth = 1;
        candidateStart = index + 2;
        index += 1;
      }
      continue;
    }

    const character = source[index];
    if (character === "[") bracketDepth += 1;
    if (character === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0) {
        parenthesisDepth = 0;
        candidateStart = -1;
      }
    }
    if (character === "(") parenthesisDepth += 1;
    if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    if (character === "," && bracketDepth === 1 && parenthesisDepth === 0) {
      candidateStart = index + 1;
    }
  }

  return (
    bracketDepth === 1 &&
    parenthesisDepth === 0 &&
    candidateStart >= 0 &&
    /^\s*$/u.test(source.slice(candidateStart))
  );
}

export function isTypeCompletionAt(source: string, start: number, end: number): boolean {
  if (isTypeReferenceAt(source, start, end)) return true;

  const before = source.slice(0, start);
  const statementStart = Math.max(
    before.lastIndexOf(";"),
    before.lastIndexOf("{"),
    before.lastIndexOf("}"),
  );
  const statement = before.slice(statementStart + 1);
  const typeName = `(?:\\\\)?${IDENTIFIER}(?:\\\\${IDENTIFIER})*`;
  const precedingTypes = `(?:\\??${typeName}\\s*[|&]\\s*)*`;

  if (
    new RegExp(
      `^\\s*(?:(?:public|protected|private|static|readonly|final|abstract|var)\\s+)+${precedingTypes}$`,
      "iu",
    ).test(statement)
  ) {
    return true;
  }
  if (new RegExp(`\\bthrows\\s+${precedingTypes}$`, "iu").test(statement)) return true;

  const openParenthesis = before.lastIndexOf("(");
  if (openParenthesis > statementStart && before.lastIndexOf(")") < openParenthesis) {
    const declaration = before.slice(statementStart + 1, openParenthesis);
    const parameter =
      before
        .slice(openParenthesis + 1)
        .split(",")
        .at(-1) ?? "";
    if (
      new RegExp(`\\b(?:function|fn)\\s*(?:&\\s*)?(?:${IDENTIFIER}\\s*)?$`, "iu").test(
        declaration,
      ) &&
      new RegExp(
        `^\\s*(?:(?:public|protected|private|readonly)\\s+)*${precedingTypes}$`,
        "iu",
      ).test(parameter)
    ) {
      return true;
    }
  }

  const genericOpen = before.lastIndexOf("<");
  if (genericOpen > statementStart) {
    const outer = new RegExp(`${typeName}\\s*$`, "iu").exec(before.slice(0, genericOpen));
    if (outer?.index !== undefined) {
      const outerStart = outer.index;
      const outerEnd = outerStart + outer[0].trimEnd().length;
      if (isTypeCompletionAt(source, outerStart, outerEnd)) return true;
    }
  }

  return false;
}

function unqualifiedTypeReferences(
  source: string,
  scope: ImportScope,
  ignoredOffset: number,
): Set<string> {
  const references = new Set<string>();
  const expression = new RegExp(IDENTIFIER, "giu");
  for (const match of source.slice(scope.start, scope.end).matchAll(expression)) {
    const start = scope.start + (match.index ?? 0);
    const end = start + match[0].length;
    if (start <= ignoredOffset && ignoredOffset <= end) continue;
    if (source[start - 1] === "\\" || source[end] === "\\") continue;
    if (isTypeReferenceAt(source, start, end)) references.add(match[0].toLowerCase());
  }
  return references;
}

function equalName(left: string, right: string): boolean {
  return left.replace(/^\\/u, "").toLowerCase() === right.replace(/^\\/u, "").toLowerCase();
}
