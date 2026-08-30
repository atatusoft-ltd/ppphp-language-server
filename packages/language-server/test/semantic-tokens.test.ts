import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SEMANTIC_TOKEN_LEGEND, semanticTokens } from "../src/semantic-tokens.js";

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
      { text: "string", type: "type" },
      { text: "throws", type: "keyword" },
      { text: "StorageFailure", type: "type" },
      { text: "NetworkFailure", type: "type" },
      { text: "readonly", type: "keyword" },
      { text: "array", type: "type" },
      { text: "string", type: "type" },
      { text: "Person", type: "type" },
      { text: "Person", type: "type" },
      { text: "string", type: "type" },
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
    expect(tokens).toEqual([
      { text: "string", type: "type" },
      { text: "when", type: "keyword" },
    ]);
  });
});

function decode(document: TextDocument): DecodedToken[] {
  const data = semanticTokens(document).data;
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
