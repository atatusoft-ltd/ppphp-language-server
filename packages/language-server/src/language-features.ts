import {
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  SymbolKind,
  type CompletionItem,
  type DocumentSymbol,
  type Hover,
  type Position,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";

export const COMPLETIONS: readonly CompletionItem[] = [
  {
    label: "readonly local declaration",
    detail: "Declare a readonly, explicitly typed local",
    kind: CompletionItemKind.Snippet,
    insertText: "readonly ${1:Type} \\$${2:name} = ${0:value};",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "typed local declaration",
    detail: "Declare an explicitly typed local",
    kind: CompletionItemKind.Snippet,
    insertText: "${1:Type} \\$${2:name} = ${0:value};",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "array<T>",
    detail: "Typed list array",
    kind: CompletionItemKind.Snippet,
    insertText: "array<${1:ValueType}>",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "array<K, V>",
    detail: "Typed associative array",
    kind: CompletionItemKind.Snippet,
    insertText: "array<${1:KeyType}, ${2:ValueType}>",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "when expression",
    detail: "Create a value-producing conditional expression",
    kind: CompletionItemKind.Snippet,
    insertText:
      "when (${1:condition}) {\n\treturn ${2:value};\n} else {\n\treturn ${0:fallback};\n}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "throws clause",
    detail: "Declare checked errors from a callable",
    kind: CompletionItemKind.Snippet,
    insertText: "throws ${1:ErrorType}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "generic class",
    detail: "Declare a generic class",
    kind: CompletionItemKind.Snippet,
    insertText: "class ${1:Name}<${2:T}> {\n\t$0\n}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  {
    label: "generic function",
    detail: "Declare a generic function",
    kind: CompletionItemKind.Snippet,
    insertText: "function ${1:name}<${2:T}>(${2:T} \\$${3:value}): ${2:T}\n{\n\t$0\n}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
] as const;

const HOVERS: Readonly<Record<string, string>> = {
  array:
    "`array<T>` is a typed list and `array<K, V>` is a typed associative array. Generic arguments are checked by ++PHP and erased to PHP with PHPDoc metadata.",
  readonly:
    "On a local declaration, `readonly` prevents reassignment and mutation through that local storage location. It does not recursively freeze referenced objects.",
  throws:
    "A `throws` clause declares checked errors that may escape a callable. The clause is erased to PHPDoc metadata in generated PHP.",
  when: "A `when` expression produces a value. It requires a final `else`; each reachable branch must return a value or terminate.",
};

export function hoverAt(document: TextDocument, position: Position): Hover | null {
  const offset = document.offsetAt(position);
  const word = wordAt(document.getText(), offset).toLowerCase();
  const value = HOVERS[word];

  return value
    ? {
        contents: {
          kind: MarkupKind.Markdown,
          value,
        },
      }
    : null;
}

export function documentSymbols(document: TextDocument): DocumentSymbol[] {
  const source = document.getText();
  const searchable = maskNonCode(source);
  const symbols: DocumentSymbol[] = [];
  const declarations = [
    {
      expression: /\b(namespace)\s+([A-Za-z_\\][A-Za-z0-9_\\]*)/g,
      kind: SymbolKind.Namespace,
    },
    {
      expression: /\b(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
      kind: SymbolKind.Class,
    },
    {
      expression: /\b(function)\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      kind: SymbolKind.Function,
    },
  ] as const;

  for (const declaration of declarations) {
    for (const match of searchable.matchAll(declaration.expression)) {
      const name = match[2];
      const fullMatch = match[0];
      const matchOffset = match.index;
      if (!name || !fullMatch || matchOffset === undefined) continue;

      const nameOffset = matchOffset + fullMatch.lastIndexOf(name);
      const range = {
        start: document.positionAt(matchOffset),
        end: document.positionAt(matchOffset + fullMatch.length),
      };
      symbols.push({
        name,
        kind:
          match[1] === "interface"
            ? SymbolKind.Interface
            : match[1] === "trait"
              ? SymbolKind.Class
              : match[1] === "enum"
                ? SymbolKind.Enum
                : declaration.kind,
        range,
        selectionRange: {
          start: document.positionAt(nameOffset),
          end: document.positionAt(nameOffset + name.length),
        },
      });
    }
  }

  return symbols.sort(
    (left, right) => document.offsetAt(left.range.start) - document.offsetAt(right.range.start),
  );
}

function wordAt(source: string, requestedOffset: number): string {
  const isWord = (character: string | undefined): boolean =>
    character !== undefined && /[A-Za-z0-9_]/.test(character);
  let start = Math.min(Math.max(requestedOffset, 0), source.length);

  if (!isWord(source[start]) && isWord(source[start - 1])) start -= 1;
  let end = start;
  while (start > 0 && isWord(source[start - 1])) start -= 1;
  while (end < source.length && isWord(source[end])) end += 1;
  return source.slice(start, end);
}

export function maskNonCode(source: string): string {
  // LSP offsets use UTF-16 code units. split("") preserves that indexing;
  // spreading a string would collapse surrogate pairs and shift later symbols.
  const output = source.split("");
  const mask = (start: number, end: number): void => {
    for (let index = start; index < end; index += 1) {
      if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
    }
  };

  let index = 0;
  while (index < source.length) {
    const next = source[index + 1];
    if (source[index] === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      mask(index, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (source[index] === "#") {
      const end = source.indexOf("\n", index + 1);
      mask(index, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (source[index] === "/" && next === "*") {
      const closing = source.indexOf("*/", index + 2);
      const end = closing === -1 ? source.length : closing + 2;
      mask(index, end);
      index = end;
      continue;
    }
    if (source[index] === "'" || source[index] === '"' || source[index] === "`") {
      const quote = source[index];
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }
        if (source[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      mask(index, end);
      index = end;
      continue;
    }
    if (source.startsWith("<<<", index)) {
      const opening = source
        .slice(index)
        .match(/^<<<[\t ]*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?[\t ]*\r?\n/);
      const identifier = opening?.[1];
      if (opening && identifier) {
        const bodyStart = index + opening[0].length;
        const closingPattern = new RegExp(`^${identifier};?[\\t ]*$`, "m");
        const closing = closingPattern.exec(source.slice(bodyStart));
        const end = closing ? bodyStart + (closing.index ?? 0) + closing[0].length : source.length;
        mask(index, end);
        index = end;
        continue;
      }
    }
    index += 1;
  }

  return output.join("");
}
