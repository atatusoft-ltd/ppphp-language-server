import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SEMANTIC_TOKEN_LEGEND, semanticTokens } from "../src/semantic-tokens.js";
import type { SemanticTokenClassification } from "../src/semantic-tokens.js";

interface DecodedToken {
  text: string;
  type: string;
}

describe("semantic tokens", () => {
  it("classifies ++PHP syntax once for every LSP client", () => {
    const document = TextDocument.create(
      "file:///example.ppphp",
      "ppphp",
      1,
      `<?php
function load(string $id): Person throws StorageFailure, NetworkFailure
{
    readonly array<string, Person> $people = [];
    Person $person = new Person();
    string $label = when ($person !== null) { return 'ready'; };

    // readonly Person $commented = new Person();
    $text = "when throws HiddenFailure";
    val $legacy = 1;
    var $inferred = 2;
}
`,
    );

    expect(decode(document)).toEqual([
      { text: "throws", type: "keyword" },
      { text: "StorageFailure", type: "type" },
      { text: "NetworkFailure", type: "type" },
      { text: "readonly", type: "keyword" },
      { text: "Person", type: "type" },
      { text: "Person", type: "type" },
      { text: "when", type: "keyword" },
    ]);
  });

  it("preserves UTF-16 positions after masked astral characters", () => {
    const document = TextDocument.create(
      "file:///unicode.ppphp",
      "ppphp",
      1,
      "<?php\n$message = '👋';\nstring $label = when (true) { return 'ok'; };\n",
    );

    const tokens = decode(document);
    expect(tokens).toEqual([{ text: "when", type: "keyword" }]);
  });

  it("merges compiler-owned PHP symbol roles with the ++PHP fallback", () => {
    const document = TextDocument.create(
      "file:///Box.ppphp",
      "ppphp",
      1,
      `<?php
class Box<T>
{
    public function getValue(): T
    {
        return $this->value;
    }
}

readonly Box<string> $box = new Box();
$box->getValue();
`,
    );
    const compilerTokens: SemanticTokenClassification[] = [
      token(document, "Box", 1, "class", ["declaration"]),
      token(document, "getValue", 1, "method", ["declaration"]),
      token(document, "value", 1, "property"),
      token(document, "getValue", 2, "method"),
    ];

    expect(decode(document, compilerTokens)).toEqual(
      expect.arrayContaining([
        { text: "Box", type: "class" },
        { text: "getValue", type: "method" },
        { text: "value", type: "property" },
        { text: "readonly", type: "keyword" },
      ]),
    );
    expect(
      decode(document, compilerTokens).filter((entry) => entry.text === "getValue"),
    ).toHaveLength(2);
  });
});

function decode(
  document: TextDocument,
  compilerTokens: SemanticTokenClassification[] = [],
): DecodedToken[] {
  const data = semanticTokens(document, compilerTokens).data;
  const decoded: DecodedToken[] = [];
  let line = 0;
  let character = 0;

  for (let index = 0; index < data.length; index += 5) {
    const lineDelta = data[index] ?? 0;
    const characterDelta = data[index + 1] ?? 0;
    line += lineDelta;
    character = lineDelta === 0 ? character + characterDelta : characterDelta;

    const length = data[index + 2] ?? 0;
    const typeIndex = data[index + 3] ?? -1;
    const offset = document.offsetAt({ line, character });
    decoded.push({
      text: document.getText().slice(offset, offset + length),
      type: SEMANTIC_TOKEN_LEGEND.tokenTypes[typeIndex] ?? "unknown",
    });
  }

  return decoded;
}

function token(
  document: TextDocument,
  text: string,
  occurrence: number,
  type: SemanticTokenClassification["type"],
  modifiers: SemanticTokenClassification["modifiers"] = [],
): SemanticTokenClassification {
  let offset = -1;

  for (let index = 0; index < occurrence; index++) {
    offset = document.getText().indexOf(text, offset + 1);
  }

  if (offset < 0) throw new Error(`Could not find occurrence ${occurrence} of ${text}.`);

  return {
    type,
    modifiers,
    range: {
      start: document.positionAt(offset),
      end: document.positionAt(offset + text.length),
    },
  };
}
