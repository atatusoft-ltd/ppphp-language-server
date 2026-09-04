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

  it("does not shorten a local type through an imported alias", () => {
    const local = type("Repository", "App", "interface");
    const source =
      "<?php\nnamespace App;\n\nuse Vendor\\Contracts\\Repository;\n\nclass Service implements \\App\\Repository {}\n";

    expect(actionsAt(source, source.lastIndexOf("Repository"), [local])).toEqual([]);
  });

  it("does not rebind an existing unqualified type reference", () => {
    const source =
      "<?php\nnamespace App;\n\nclass Service { private Repository $current; public function make(): \\Vendor\\Contracts\\Repository {} }\n";

    expect(actionsAt(source, source.lastIndexOf("Repository"), [REPOSITORY])).toEqual([]);
  });

  it("does not rebind an existing generic type argument", () => {
    const product = type("Product", "Vendor", "class");
    const source =
      "<?php\nnamespace App;\n\nclass Service { private Collection<Product> $items; public function make(): \\Vendor\\Product {} }\n";

    expect(actionsAt(source, source.lastIndexOf("Product"), [product])).toEqual([]);
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

  it("ignores qualified names in heredoc and nowdoc bodies", () => {
    const heredoc = "<?php\n$value = <<<TEXT\nnew \\Vendor\\Contracts\\Repository\n    TEXT;\n";
    const nowdoc = "<?php\n$value = <<<'TEXT'\nnew \\Vendor\\Contracts\\Repository\nTEXT;\n";

    expect(actionsAt(heredoc, heredoc.indexOf("Repository"), [REPOSITORY])).toEqual([]);
    expect(actionsAt(nowdoc, nowdoc.indexOf("Repository"), [REPOSITORY])).toEqual([]);
  });

  it("offers imports only where a qualified name is a type reference", () => {
    const property =
      "<?php\nclass Service { private \\Vendor\\Contracts\\Repository $repository; }\n";
    const functionCall = "<?php\n$result = \\Vendor\\Contracts\\Repository();\n";
    const constant = "<?php\n$result = \\Vendor\\Contracts\\Repository;\n";

    expect(actionsAt(property, property.indexOf("Repository"), [REPOSITORY])).toHaveLength(1);
    expect(actionsAt(functionCall, functionCall.indexOf("Repository"), [REPOSITORY])).toEqual([]);
    expect(actionsAt(constant, constant.indexOf("Repository"), [REPOSITORY])).toEqual([]);
  });

  it("distinguishes attribute names from attribute argument expressions", () => {
    const attribute = "<?php #[\\Vendor\\Contracts\\Repository] class Service {}\n";
    const grouped = "<?php #[Example, \\Vendor\\Contracts\\Repository] class Service {}\n";
    const argument = "<?php #[Example(1, \\Vendor\\Contracts\\Repository())] class Service {}\n";

    expect(actionsAt(attribute, attribute.indexOf("Repository"), [REPOSITORY])).toHaveLength(1);
    expect(actionsAt(grouped, grouped.indexOf("Repository"), [REPOSITORY])).toHaveLength(1);
    expect(actionsAt(argument, argument.indexOf("Repository"), [REPOSITORY])).toEqual([]);
  });

  it("inserts the first import after leading declare statements", () => {
    const source =
      "<?php\ndeclare(strict_types=1);\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";
    const updated = applyFirstAction(source, source.indexOf("Repository") + 2, [REPOSITORY]);

    expect(updated).toBe(
      "<?php\ndeclare(strict_types=1);\n\nuse Vendor\\Contracts\\Repository;\n\nclass Service implements Repository {}\n",
    );
  });

  it("does not mistake a closure capture for an import anchor", () => {
    const source =
      "<?php\nnamespace App;\n\n$callback = function () use ($value) {};\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";
    const updated = applyFirstAction(source, source.lastIndexOf("Repository") + 2, [REPOSITORY]);

    expect(updated).toBe(
      "<?php\nnamespace App;\n\nuse Vendor\\Contracts\\Repository;\n\n$callback = function () use ($value) {};\n\nclass Service implements Repository {}\n",
    );
  });

  it("places generated imports alphabetically, by length, or after existing imports", () => {
    const alphabeticSource =
      "<?php\nnamespace App;\n\nuse Vendor\\Domain\\Product;\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";
    const lengthSource =
      "<?php\nnamespace App;\n\nuse Vendor\\LongerNamespace\\Zebra;\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";

    expect(
      applyFirstAction(
        alphabeticSource,
        alphabeticSource.lastIndexOf("Repository") + 2,
        [REPOSITORY],
        "alphabetic",
      ),
    ).toContain("use Vendor\\Contracts\\Repository;\nuse Vendor\\Domain\\Product;");
    expect(
      applyFirstAction(
        lengthSource,
        lengthSource.lastIndexOf("Repository") + 2,
        [REPOSITORY],
        "length",
      ),
    ).toContain("use Vendor\\Contracts\\Repository;\nuse Vendor\\LongerNamespace\\Zebra;");
    expect(
      applyFirstAction(
        lengthSource,
        lengthSource.lastIndexOf("Repository") + 2,
        [REPOSITORY],
        "none",
      ),
    ).toContain("use Vendor\\LongerNamespace\\Zebra;\nuse Vendor\\Contracts\\Repository;");
  });

  it("preserves indentation and comments attached to existing imports", () => {
    const indented =
      "<?php\nnamespace App {\n    use Vendor\\Domain\\Product;\n\n    class Service implements \\Vendor\\Contracts\\Repository {}\n}\n";
    const commented =
      "<?php\nnamespace App;\n\n// Required by the product boundary.\nuse Vendor\\Domain\\Product;\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";

    expect(
      applyFirstAction(indented, indented.lastIndexOf("Repository") + 2, [REPOSITORY]),
    ).toContain("    use Vendor\\Contracts\\Repository;\n    use Vendor\\Domain\\Product;");
    expect(
      applyFirstAction(commented, commented.lastIndexOf("Repository") + 2, [REPOSITORY]),
    ).toContain(
      "// Required by the product boundary.\nuse Vendor\\Domain\\Product;\nuse Vendor\\Contracts\\Repository;",
    );
  });

  it("preserves a trailing comment when appending an import", () => {
    const source =
      "<?php\nnamespace App;\n\nuse Vendor\\Domain\\Product; // Domain model.\n\nclass Service implements \\Vendor\\Contracts\\Repository {}\n";
    const updated = applyFirstAction(
      source,
      source.lastIndexOf("Repository") + 2,
      [REPOSITORY],
      "none",
    );

    expect(updated).toContain(
      "use Vendor\\Domain\\Product; // Domain model.\nuse Vendor\\Contracts\\Repository;",
    );
  });
});

function applyFirstAction(
  source: string,
  offset: number,
  catalog: readonly TypeCatalogEntry[],
  importSorting: "alphabetic" | "length" | "none" = "alphabetic",
): string {
  const document = createDocument(source);
  const actions = typeImportCodeActionsAt(
    document,
    { start: document.positionAt(offset), end: document.positionAt(offset) },
    catalog,
    importSorting,
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
    abstract: false,
    final: false,
    origin: "dependency",
  };
}
