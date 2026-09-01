import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CompilerSymbolDefinition, CompilerSymbolResult } from "../src/compiler-definition.js";
import {
  discoverProjectDocuments,
  identifierAt,
  prepareTypeRenameAt,
  renameTypeAt,
  type ProjectSourceDocument,
} from "../src/compiler-rename.js";

const SETTINGS = { timeoutMilliseconds: 1_000 };

describe("compiler-backed type rename", () => {
  it("prepares only project-owned class-family symbols", async () => {
    const source = "<?php\nclass Transaction {}\n";
    const filePath = "/workspace/src/Transaction.ppphp";
    const document = createDocument(filePath, source, 3);
    const position = document.positionAt(source.indexOf("Transaction") + 2);
    const definition = symbol("type:shop\\transaction", "class", filePath, source, "Transaction");

    await expect(
      prepareTypeRenameAt(document, position, filePath, "/workspace", SETTINGS, {
        resolveSymbol: async () => ({ symbol: definition }),
      }),
    ).resolves.toEqual({
      prepare: {
        range: {
          start: { line: 1, character: 6 },
          end: { line: 1, character: 17 },
        },
        placeholder: "Transaction",
      },
    });

    await expect(
      prepareTypeRenameAt(document, position, filePath, "/workspace", SETTINGS, {
        resolveSymbol: async () => ({
          symbol: { ...definition, kind: "method", symbolId: "method:shop\\cart::transaction" },
        }),
      }),
    ).resolves.toEqual({ prepare: null });
  });

  it("renames semantic type references across files and renames a matching source file", async () => {
    const workspaceRoot = "/workspace";
    const declarationPath = "/workspace/src/Transaction.ppphp";
    const consumerPath = "/workspace/src/Checkout.ppphp";
    const unrelatedPath = "/workspace/src/Other.ppphp";
    const declarationText = "<?php\n// 😀\nnamespace Shop;\nclass Transaction {}\n";
    const consumerText =
      "<?php\nnamespace App;\nuse Shop\\Transaction;\n" +
      'Transaction $transaction = new TRANSACTION();\n$label = "Transaction";\n';
    const unrelatedText = "<?php\nnamespace Other;\nclass Transaction {}\n";
    const declaration = sourceDocument(declarationPath, declarationText, 4);
    const consumer = sourceDocument(consumerPath, consumerText, 7);
    const unrelated = sourceDocument(unrelatedPath, unrelatedText, null);
    const sources = [declaration, consumer, unrelated];
    const resolveSymbol = createTypeResolver({
      declarationPath,
      declarationName: "Transaction",
      declarationText,
      renamedName: "Purchase",
      targetId: "type:shop\\transaction",
      renamedId: "type:shop\\purchase",
      consumerPath,
      unrelatedPath,
    });
    const position = declaration.document.positionAt(declarationText.indexOf("Transaction") + 3);

    const result = await renameTypeAt(
      declaration.document,
      position,
      "Purchase",
      declarationPath,
      workspaceRoot,
      SETTINGS,
      sources.map(({ document }) => document),
      { documentChanges: true, renameFileOperations: true },
      {
        resolveSymbol,
        loadProjectDocuments: async () => sources,
        pathExists: async () => false,
      },
    );

    expect(result.rejectionReason).toBeUndefined();
    expect(result.unavailableReason).toBeUndefined();
    expect(result.edit?.documentChanges).toHaveLength(3);
    expect(result.edit?.documentChanges?.[0]).toMatchObject({
      textDocument: { uri: consumer.document.uri, version: 7 },
      edits: [{ newText: "Purchase" }, { newText: "Purchase" }, { newText: "Purchase" }],
    });
    expect(result.edit?.documentChanges?.[1]).toMatchObject({
      textDocument: { uri: declaration.document.uri, version: 4 },
      edits: [{ newText: "Purchase" }],
    });
    expect(result.edit?.documentChanges?.[2]).toEqual({
      kind: "rename",
      oldUri: declaration.document.uri,
      newUri: pathToFileURL("/workspace/src/Purchase.ppphp").toString(),
      options: { overwrite: false, ignoreIfExists: false },
    });

    const changes = JSON.stringify(result.edit);
    expect(changes).not.toContain(unrelated.document.uri);
    expect(changes).not.toContain("$label");
  });

  it("refuses namespace collisions and compiler-rejected replacement names", async () => {
    const declarationPath = "/workspace/src/Transaction.ppphp";
    const collisionPath = "/workspace/src/Purchase.ppphp";
    const declarationText = "<?php\nnamespace Shop;\nclass Transaction {}\n";
    const collisionText = "<?php\nnamespace Shop;\nclass Purchase {}\n";
    const declaration = sourceDocument(declarationPath, declarationText, 1);
    const collision = sourceDocument(collisionPath, collisionText, null);
    const position = declaration.document.positionAt(declarationText.indexOf("Transaction"));
    const resolver = async (
      document: TextDocument,
      candidate: { line: number; character: number },
    ): Promise<CompilerSymbolResult> => {
      const name = identifierAt(document, candidate)?.name;
      if (name === "Transaction") {
        return {
          symbol: symbol(
            "type:shop\\transaction",
            "class",
            declarationPath,
            declarationText,
            "Transaction",
          ),
        };
      }
      if (name === "Purchase") {
        return {
          symbol: symbol("type:shop\\purchase", "class", collisionPath, collisionText, "Purchase"),
        };
      }
      return { symbol: null };
    };

    const collisionResult = await renameTypeAt(
      declaration.document,
      position,
      "Purchase",
      declarationPath,
      "/workspace",
      SETTINGS,
      [declaration.document],
      { documentChanges: true, renameFileOperations: true },
      {
        resolveSymbol: resolver,
        loadProjectDocuments: async () => [declaration, collision],
        pathExists: async () => true,
      },
    );
    expect(collisionResult.rejectionReason).toBe(
      "A type named Purchase already exists in the target namespace.",
    );

    const keywordResult = await renameTypeAt(
      declaration.document,
      position,
      "class",
      declarationPath,
      "/workspace",
      SETTINGS,
      [declaration.document],
      { documentChanges: true, renameFileOperations: true },
      {
        resolveSymbol: async (document, candidate) => {
          const name = identifierAt(document, candidate)?.name;
          return name === "Transaction"
            ? {
                symbol: symbol(
                  "type:shop\\transaction",
                  "class",
                  declarationPath,
                  declarationText,
                  "Transaction",
                ),
              }
            : { symbol: null };
        },
        loadProjectDocuments: async () => [declaration],
        pathExists: async () => false,
      },
    );
    expect(keywordResult.rejectionReason).toContain("compiler rejected class");
  });

  it("discovers only configured canonical source files and keeps unsaved content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-rename-"));
    const sourceRoot = path.join(root, "src");
    const outputRoot = path.join(root, "build");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(outputRoot, { recursive: true });
    await writeFile(
      path.join(root, "ppphp.json"),
      JSON.stringify({ source: ["src"], output: "build", cache: ".ppphp-cache" }),
    );
    const sourcePath = path.join(sourceRoot, "Cart.ppphp");
    await writeFile(sourcePath, "<?php class Cart {}\n");
    await writeFile(path.join(sourceRoot, "Retired.ppp"), "ignored\n");
    await writeFile(path.join(outputRoot, "Generated.ppphp"), "ignored\n");
    const open = createDocument(sourcePath, "<?php class UnsavedCart {}\n", 9);

    const documents = await discoverProjectDocuments(root, [open]);

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ filePath: sourcePath, version: 9 });
    expect(documents[0]?.document.getText()).toContain("UnsavedCart");
  });

  it("preserves UTF-16 identifier ranges after astral characters and ignores strings", () => {
    const source = "<?php\n$message = '😀 Transaction';\nclass Transaction {}\n";
    const document = TextDocument.create("file:///unicode.ppphp", "ppphp", 1, source);
    const occurrence = identifierAt(
      document,
      document.positionAt(source.lastIndexOf("Transaction") + 4),
    );

    expect(occurrence).toMatchObject({
      name: "Transaction",
      range: {
        start: { line: 2, character: 6 },
        end: { line: 2, character: 17 },
      },
    });
    expect(identifierAt(document, { line: 1, character: 17 })).toBeNull();
  });
});

function createTypeResolver(options: {
  declarationPath: string;
  declarationName: string;
  declarationText: string;
  renamedName: string;
  targetId: string;
  renamedId: string;
  consumerPath: string;
  unrelatedPath: string;
}): (
  document: TextDocument,
  position: { line: number; character: number },
) => Promise<CompilerSymbolResult> {
  return async (document, position) => {
    const occurrence = identifierAt(document, position);
    const name = occurrence?.name;
    const filePath = filePathFromDocument(document);
    if (occurrence && document.getText()[occurrence.start - 1] === "$") {
      return { symbol: null };
    }
    if (filePath === options.unrelatedPath && name?.toLowerCase() === "transaction") {
      return {
        symbol: symbol(
          "type:other\\transaction",
          "class",
          options.unrelatedPath,
          document.getText(),
          name,
        ),
      };
    }
    if (
      (filePath === options.declarationPath || filePath === options.consumerPath) &&
      name?.toLowerCase() === options.declarationName.toLowerCase()
    ) {
      return {
        symbol: symbol(
          options.targetId,
          "class",
          options.declarationPath,
          options.declarationText,
          options.declarationName,
        ),
      };
    }
    if (filePath === options.declarationPath && name === options.renamedName) {
      return {
        symbol: symbol(
          options.renamedId,
          "class",
          options.declarationPath,
          document.getText(),
          options.renamedName,
        ),
      };
    }
    return { symbol: null };
  };
}

function sourceDocument(
  filePath: string,
  text: string,
  version: number | null,
): ProjectSourceDocument {
  return {
    document: createDocument(filePath, text, version ?? 0),
    filePath,
    version,
  };
}

function createDocument(filePath: string, text: string, version: number): TextDocument {
  return TextDocument.create(pathToFileURL(filePath).toString(), "ppphp", version, text);
}

function symbol(
  symbolId: string,
  kind: string,
  filePath: string,
  source: string,
  name: string,
): CompilerSymbolDefinition {
  const utf16Start = source.indexOf(name);
  const start = Buffer.byteLength(source.slice(0, utf16Start), "utf8");
  const end = start + Buffer.byteLength(name, "utf8");
  return {
    symbolId,
    kind,
    filePath,
    range: { start, end },
    selectionRange: { start, end },
  };
}

function filePathFromDocument(document: TextDocument): string {
  return decodeURIComponent(new URL(document.uri).pathname);
}
