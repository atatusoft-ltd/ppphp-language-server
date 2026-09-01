import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CompilerSymbolDefinition } from "../src/compiler-definition.js";
import { identifierAt, type ProjectSourceDocument } from "../src/compiler-rename.js";
import { decodeRenameCommandRequest, executeRenameCommand } from "../src/rename-command.js";

describe("native editor rename command", () => {
  it("decodes a bounded request inside the workspace", () => {
    const request = decodeRenameCommandRequest(
      JSON.stringify({
        version: 1,
        document: { path: "src/Cart.ppphp", contents: "<?php class Cart {}", version: 4 },
        openDocuments: [],
        position: { offset: 12 },
        newName: "Basket",
      }),
      "/workspace",
    );

    expect(request).toMatchObject({
      document: { path: path.normalize("/workspace/src/Cart.ppphp"), version: 4 },
      positionOffset: 12,
      newName: "Basket",
    });
  });

  it("rejects non-canonical and out-of-workspace documents", () => {
    for (const documentPath of ["src/Cart.ppp", "../Cart.ppphp"]) {
      expect(() =>
        decodeRenameCommandRequest(
          JSON.stringify({
            version: 1,
            document: { path: documentPath, contents: "<?php", version: 0 },
            position: { offset: 0 },
            newName: "Basket",
          }),
          "/workspace",
        ),
      ).toThrowError("must be a .ppphp file inside the workspace");
    }
  });

  it("returns compiler-verified text and file edits for the native PhpStorm bridge", async () => {
    const workspaceRoot = "/workspace";
    const filePath = "/workspace/src/Cart.ppphp";
    const source = "<?php\nnamespace Shop;\nclass Cart {}\n";
    const request = JSON.stringify({
      version: 1,
      document: { path: filePath, contents: source, version: 6 },
      openDocuments: [],
      position: { offset: source.indexOf("Cart") },
      newName: "Basket",
    });

    const response = await executeRenameCommand(request, workspaceRoot, {
      resolveSymbol: async (document, position) => {
        const name = identifierAt(document, position)?.name;
        if (name === "Cart") {
          return { symbol: definition("type:shop\\cart", filePath, source, "Cart") };
        }
        if (name === "Basket") {
          return {
            symbol: definition("type:shop\\basket", filePath, document.getText(), "Basket"),
          };
        }
        return { symbol: null };
      },
      loadProjectDocuments: async (_root, openDocuments) =>
        openDocuments.map((document): ProjectSourceDocument => ({
          document,
          filePath,
          version: document.version,
        })),
      pathExists: async () => false,
    });

    expect(response.error).toBeNull();
    expect(response.edit?.documentChanges).toEqual([
      {
        textDocument: { uri: "file:///workspace/src/Cart.ppphp", version: 6 },
        edits: [
          {
            range: {
              start: { line: 2, character: 6 },
              end: { line: 2, character: 10 },
            },
            newText: "Basket",
          },
        ],
      },
      {
        kind: "rename",
        oldUri: "file:///workspace/src/Cart.ppphp",
        newUri: "file:///workspace/src/Basket.ppphp",
        options: { overwrite: false, ignoreIfExists: false },
      },
    ]);
  });
});

function definition(
  symbolId: string,
  filePath: string,
  source: string,
  name: string,
): CompilerSymbolDefinition {
  const characterOffset = source.indexOf(name);
  const start = Buffer.byteLength(source.slice(0, characterOffset), "utf8");
  const end = start + Buffer.byteLength(name, "utf8");
  return {
    symbolId,
    kind: "class",
    filePath,
    range: { start, end },
    selectionRange: { start, end },
  };
}
