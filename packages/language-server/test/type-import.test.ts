import { TextDocument } from "vscode-languageserver-textdocument";
import { describe, expect, it } from "vitest";
import type { TypeCatalogEntry } from "../src/type-catalog.js";
import { typeImportCodeActionsAt } from "../src/type-import.js";

const REPOSITORY = type("Repository", "Vendor\\Contracts", "interface");

describe("type import actions", () => {
  it("shortens a known qualified type and adds its import", () => {
    const source =
      "<?php\n\nnamespace App;\n\nclass Service implements \\Vendor\\Contracts\\Repository<Item> {}\n";
    const updated = applyFirstAction(source, source.indexOf("Repository") + 2, [REPOSITORY]);

    expect(updated).toBe(
      "<?php\n\nnamespace App;\n\nuse Vendor\\Contracts\\Repository;\n\nclass Service implements Repository<Item> {}\n",
    );
  });

  it("reuses an existing alias without adding a duplicate import", () => {
    const source =
      "<?php\nnamespace App;\n\nuse Vendor\\Contracts\\Repository as Store;\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";
    const updated = applyFirstAction(source, source.lastIndexOf("Repository") + 2, [REPOSITORY]);

    expect(updated).toBe(
      "<?php\nnamespace App;\n\nuse Vendor\\Contracts\\Repository as Store;\n\nclass Service implements Store {}\n",
    );
  });

  it("does not offer an unsafe import when the short name collides", () => {
    const source =
      "<?php\nnamespace App;\n\nuse Other\\Repository;\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";
    const document = createDocument(source);
    const offset = source.lastIndexOf("Repository") + 2;

    expect(
      typeImportCodeActionsAt(
        document,
        { start: document.positionAt(offset), end: document.positionAt(offset) },
        [REPOSITORY],
      ),
    ).toEqual([]);
  });

  it("preserves CRLF and supports bracketed namespaces", () => {
    const source =
      "<?php\r\nnamespace App {\r\n\r\nclass Service implements \\Vendor\\Contracts\\Repository {}\r\n}\r\n";
    const updated = applyFirstAction(source, source.indexOf("Repository") + 2, [REPOSITORY]);

    expect(updated).toContain(
      "namespace App {\r\n\r\nuse Vendor\\Contracts\\Repository;\r\n\r\nclass Service implements Repository",
    );
  });

  it("ignores qualified names in comments and import declarations", () => {
    const comment = "<?php\n// \\Vendor\\Contracts\\Repository\nclass Service {}\n";
    const imported = "<?php\nuse \\Vendor\\Contracts\\Repository;\nclass Service {}\n";
    const relative = "<?php\nclass Service implements Vendor\\Contracts\\Repository {}\n";

    expect(actionsAt(comment, comment.indexOf("Repository"), [REPOSITORY])).toEqual([]);
    expect(actionsAt(imported, imported.indexOf("Repository"), [REPOSITORY])).toEqual([]);
    expect(actionsAt(relative, relative.indexOf("Repository"), [REPOSITORY])).toEqual([]);
  });

  it("does not mistake a closure capture for an import anchor", () => {
    const source =
      "<?php\nnamespace App;\n\n$callback = function () use ($value) {};\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";
    const updated = applyFirstAction(source, source.lastIndexOf("Repository") + 2, [REPOSITORY]);

    expect(updated).toBe(
      "<?php\nnamespace App;\n\nuse Vendor\\Contracts\\Repository;\n\n$callback = function () use ($value) {};\n\nclass Service implements Repository {}\n",
    );
  });
});

function applyFirstAction(
  source: string,
  offset: number,
  catalog: readonly TypeCatalogEntry[],
): string {
  const document = createDocument(source);
  const actions = typeImportCodeActionsAt(
    document,
    { start: document.positionAt(offset), end: document.positionAt(offset) },
    catalog,
  );
  expect(actions[0]?.title).toBe(`Use import for ${catalog[0]?.fqn}`);
  const edits = actions[0]?.edit?.changes?.[document.uri] ?? [];
  const resolved = edits
    .map((edit) => ({
      start: document.offsetAt(edit.range.start),
      end: document.offsetAt(edit.range.end),
      text: edit.newText,
    }))
    .sort((left, right) => right.start - left.start);
  let updated = source;
  for (const edit of resolved) {
    updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
  }
  return updated;
}

function actionsAt(source: string, offset: number, catalog: readonly TypeCatalogEntry[]) {
  const document = createDocument(source);
  return typeImportCodeActionsAt(
    document,
    { start: document.positionAt(offset), end: document.positionAt(offset) },
    catalog,
  );
}

function createDocument(source: string): TextDocument {
  return TextDocument.create("file:///workspace/Example.ppphp", "ppphp", 1, source);
}

function type(name: string, namespace: string, kind: TypeCatalogEntry["kind"]): TypeCatalogEntry {
  return {
    name,
    namespace,
    fqn: namespace === "" ? name : `${namespace}\\${name}`,
    kind,
    final: false,
    origin: "dependency",
  };
}
