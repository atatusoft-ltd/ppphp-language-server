import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  buildSemanticTokensRequest,
  parseCompilerSemanticTokens,
} from "../src/compiler-semantic-tokens.js";

describe("compiler semantic token mapping", () => {
  it("sends the complete unsaved document", () => {
    const source = "<?php\nclass Box {}\n";
    const document = TextDocument.create("file:///workspace/src/Box.ppphp", "ppphp", 7, source);

    expect(JSON.parse(buildSemanticTokensRequest(document, "/workspace/src/Box.ppphp"))).toEqual({
      version: 1,
      document: {
        path: "/workspace/src/Box.ppphp",
        contents: source,
      },
    });
  });

  it("maps compiler UTF-8 ranges and validates standard roles", () => {
    const source = "<?php\n$label = '👋';\nclass Box { public function getValue(): mixed {} }\n";
    const start = Buffer.byteLength("<?php\n$label = '👋';\nclass Box { public function ", "utf8");
    const end = start + Buffer.byteLength("getValue", "utf8");

    expect(
      parseCompilerSemanticTokens(
        JSON.stringify({
          version: 1,
          tokens: [
            {
              type: "method",
              modifiers: ["declaration"],
              range: { start: { offset: start }, end: { offset: end } },
            },
          ],
          error: null,
        }),
        source,
      ),
    ).toEqual([
      {
        type: "method",
        modifiers: ["declaration"],
        range: {
          start: { line: 2, character: 28 },
          end: { line: 2, character: 36 },
        },
      },
    ]);
  });

  it("accepts the standard native-library modifier from the compiler", () => {
    expect(
      parseCompilerSemanticTokens(
        JSON.stringify({
          version: 1,
          tokens: [
            {
              type: "type",
              modifiers: ["defaultLibrary"],
              range: { start: { offset: 6 }, end: { offset: 12 } },
            },
          ],
          error: null,
        }),
        "<?php string",
      ),
    ).toEqual([
      {
        type: "type",
        modifiers: ["defaultLibrary"],
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 12 },
        },
      },
    ]);
  });

  it.each([
    [
      {
        version: 2,
        tokens: [],
        error: null,
      },
      "unsupported semantic tokens envelope",
    ],
    [
      {
        version: 1,
        tokens: [{ type: "unknown", modifiers: [], range: range(0, 1) }],
        error: null,
      },
      "semantic token type is unsupported",
    ],
    [
      {
        version: 1,
        tokens: [{ type: "method", modifiers: ["unknown"], range: range(0, 1) }],
        error: null,
      },
      "semantic token modifiers are unsupported",
    ],
    [
      {
        version: 1,
        tokens: [{ type: "method", modifiers: [], range: range(0, 99) }],
        error: null,
      },
      "semantic token range is invalid",
    ],
    [
      {
        version: 1,
        tokens: [{ type: "method", modifiers: [], range: range(0, 6) }],
        error: null,
      },
      "semantic token range must be non-empty and contained on one line",
    ],
    [
      {
        version: 1,
        tokens: [],
        error: { code: "invalid-project", message: "Project unavailable." },
      },
      "Project unavailable.",
    ],
  ])("rejects an invalid compiler envelope", (envelope, message) => {
    expect(() =>
      parseCompilerSemanticTokens(JSON.stringify(envelope), "<?php\nclass Box {}"),
    ).toThrowError(message);
  });
});

function range(
  start: number,
  end: number,
): {
  start: { offset: number };
  end: { offset: number };
} {
  return { start: { offset: start }, end: { offset: end } };
}
