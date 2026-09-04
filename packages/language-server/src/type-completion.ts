import {
  CompletionItemKind,
  type CompletionItem,
  type Position,
  type Range,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { maskNonCode } from "./language-features.js";
import type { TypeCatalogEntry, TypeKind, TypeOrigin } from "./type-catalog.js";
import { createTypeImportPlanner, isTypeCompletionAt } from "./type-import.js";
import type { ImportSorting } from "./server-settings.js";

const MAXIMUM_COMPLETIONS = 200;

export function typeCompletionsAt(
  document: TextDocument,
  position: Position,
  catalog: readonly TypeCatalogEntry[],
  importSorting: ImportSorting = "alphabetic",
): CompletionItem[] {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const replacement = qualifiedNameRange(document, source, offset);
  const typed = source.slice(document.offsetAt(replacement.start), offset);
  const query = typed.replace(/^\\/u, "").toLowerCase();
  const masked = maskNonCode(source);
  const replacementStart = document.offsetAt(replacement.start);
  if (!isTypeCompletionAt(masked, replacementStart, document.offsetAt(replacement.end))) {
    return [];
  }
  const context = completionContext(masked, replacementStart);
  const importPlanner = typed.startsWith("\\")
    ? null
    : createTypeImportPlanner(document, replacementStart, importSorting);

  return catalog
    .filter(
      (entry) =>
        context.kinds.has(entry.kind) &&
        !(context.instantiableClassesOnly && entry.abstract) &&
        !(context.inheritableClassesOnly && entry.kind === "class" && entry.final),
    )
    .map((entry) => {
      const importPlan = importPlanner?.(entry) ?? null;
      return { entry, importPlan, score: matchScore(entry, query, importPlan?.reference) };
    })
    .filter((candidate) => candidate.score >= 0)
    .sort(
      (left, right) =>
        left.score - right.score ||
        originRank(right.entry.origin) - originRank(left.entry.origin) ||
        left.entry.name.localeCompare(right.entry.name) ||
        left.entry.fqn.localeCompare(right.entry.fqn),
    )
    .slice(0, MAXIMUM_COMPLETIONS)
    .map(({ entry, importPlan }, index) => {
      const reference = typed.startsWith("\\")
        ? `\\${entry.fqn}`
        : (importPlan?.reference ?? `\\${entry.fqn}`);
      return {
        label: importPlan?.reference ?? entry.name,
        kind: completionKind(entry.kind),
        detail: `${entry.fqn} — ${originLabel(entry.origin)}`,
        filterText: typed.includes("\\") ? entry.fqn : (importPlan?.reference ?? entry.name),
        sortText: index.toString().padStart(3, "0"),
        textEdit: { range: replacement, newText: reference },
        additionalTextEdits: importPlan?.importEdit ? [importPlan.importEdit] : undefined,
      };
    });
}

function qualifiedNameRange(document: TextDocument, source: string, offset: number): Range {
  let start = offset;
  while (start > 0 && /[A-Z0-9_\\\u0080-\u{10ffff}]/iu.test(source[start - 1] ?? "")) {
    start -= 1;
  }
  let end = offset;
  while (end < source.length && /[A-Z0-9_\\\u0080-\u{10ffff}]/iu.test(source[end] ?? "")) {
    end += 1;
  }
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

function completionContext(
  source: string,
  offset: number,
): {
  kinds: Set<TypeKind>;
  inheritableClassesOnly: boolean;
  instantiableClassesOnly: boolean;
} {
  const header = source.slice(Math.max(0, source.lastIndexOf("{", offset - 1) + 1), offset);
  const inheritance = /\b(extends|implements)\b(?![\s\S]*\b(?:extends|implements)\b)/iu.exec(
    header,
  );
  if (inheritance?.[1]?.toLowerCase() === "implements") {
    return {
      kinds: new Set(["interface"]),
      inheritableClassesOnly: false,
      instantiableClassesOnly: false,
    };
  }
  if (inheritance?.[1]?.toLowerCase() === "extends") {
    const declarations = [
      ...header.matchAll(
        /\b(class|interface|trait|enum)\s+[A-Z_\u0080-\u{10ffff}][A-Z0-9_\u0080-\u{10ffff}]*/giu,
      ),
    ];
    return declarations.at(-1)?.[1]?.toLowerCase() === "interface"
      ? {
          kinds: new Set(["interface"]),
          inheritableClassesOnly: false,
          instantiableClassesOnly: false,
        }
      : {
          kinds: new Set(["class"]),
          inheritableClassesOnly: true,
          instantiableClassesOnly: false,
        };
  }
  if (/\bnew\s*$/iu.test(header)) {
    return {
      kinds: new Set(["class"]),
      inheritableClassesOnly: false,
      instantiableClassesOnly: true,
    };
  }
  return {
    kinds: new Set(["class", "interface", "enum"]),
    inheritableClassesOnly: false,
    instantiableClassesOnly: false,
  };
}

function matchScore(entry: TypeCatalogEntry, query: string, reference?: string): number {
  if (query === "") return 4;
  const name = entry.name.toLowerCase();
  const fqn = entry.fqn.toLowerCase();
  const imported = reference?.toLowerCase();
  if (imported === query) return 0;
  if (imported?.startsWith(query)) return 1;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (fqn.startsWith(query)) return 2;
  if (fqn.split("\\").some((segment) => segment.startsWith(query))) return 3;
  return -1;
}

function completionKind(kind: TypeKind): CompletionItemKind {
  if (kind === "interface") return CompletionItemKind.Interface;
  if (kind === "enum") return CompletionItemKind.Enum;
  return CompletionItemKind.Class;
}

function originRank(origin: TypeOrigin): number {
  return origin === "project" ? 3 : origin === "dependency" ? 2 : 1;
}

function originLabel(origin: TypeOrigin): string {
  if (origin === "project") return "++PHP project";
  if (origin === "dependency") return "Composer dependency";
  return "PHP built-in";
}
