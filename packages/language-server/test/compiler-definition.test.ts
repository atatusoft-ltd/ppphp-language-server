import path from "node:path";
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  buildDefinitionRequest,
  parseCompilerDefinition,
  rangeFromUtf8Offsets,
} from "../src/compiler-definition.js";

describe("compiler definition mapping", () => {
  it("sends the unsaved document with a UTF-8 compiler offset", () => {
    const source = "<?php\n$label = '👋';\necho $label;\n";
    const document = TextDocument.create("file:///workspace/src/index.ppphp", "ppphp", 3, source);
    const request = JSON.parse(
      buildDefinitionRequest(document, { line: 2, character: 6 }, "/workspace/src/index.ppphp"),
    ) as {
      version: number;
      document: { path: string; contents: string };
      position: { offset: number };
    };

    expect(request).toEqual({
      version: 1,
      document: {
        path: "/workspace/src/index.ppphp",
        contents: source,
      },
      position: {
        offset: Buffer.byteLength("<?php\n$label = '👋';\necho $", "utf8"),
      },
    });
  });

  it("maps compiler byte ranges to LSP UTF-16 positions", () => {
    const source = "👋 heading\r\nclass Person {}\r\n";
    const start = Buffer.byteLength("👋 heading\r\nclass ", "utf8");
    const end = start + Buffer.byteLength("Person", "utf8");

    expect(rangeFromUtf8Offsets(source, { start, end })).toEqual({
      start: { line: 1, character: 6 },
      end: { line: 1, character: 12 },
    });
  });

  it("accepts only the versioned definition envelope", () => {
    const definition = parseCompilerDefinition(
      JSON.stringify({
        version: 1,
        definition: {
          symbolId: "type:my\\app\\person",
          kind: "class",
          location: {
            file: "src/Person.ppphp",
            range: { start: { offset: 6 }, end: { offset: 21 } },
            selectionRange: { start: { offset: 12 }, end: { offset: 18 } },
          },
        },
        error: null,
      }),
      "/workspace",
    );

    expect(definition).toEqual({
      symbolId: "type:my\\app\\person",
      kind: "class",
      filePath: path.normalize("/workspace/src/Person.ppphp"),
      range: { start: 6, end: 21 },
      selectionRange: { start: 12, end: 18 },
    });
    expect(() =>
      parseCompilerDefinition('{"version":2,"definition":null}', "/workspace"),
    ).toThrowError("unsupported definition envelope");
  });
});
