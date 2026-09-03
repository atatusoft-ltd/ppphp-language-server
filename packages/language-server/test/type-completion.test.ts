import { TextDocument } from "vscode-languageserver-textdocument";
import { describe, expect, it } from "vitest";
import type { TypeCatalogEntry } from "../src/type-catalog.js";
import { typeCompletionsAt } from "../src/type-completion.js";

const CATALOG: TypeCatalogEntry[] = [
  type("Exception", "", "class", "php-runtime"),
  type("FinalBase", "Vendor", "class", "dependency", true),
  type("JsonSerializable", "", "interface", "php-runtime"),
  type("LocalContract", "App", "interface", "project"),
  type("Repository", "Vendor\\Contracts", "interface", "dependency"),
  type("Product", "Vendor\\Domain", "class", "dependency"),
];

describe("type completion", () => {
  it("offers only inheritable classes after a class extends clause", () => {
    const items = complete("<?php namespace App; class Child extends Ex", CATALOG);

    expect(items.map(({ label }) => label)).toEqual(["Exception"]);
    expect(items[0]?.textEdit).toMatchObject({ newText: "Exception" });
    expect(items[0]?.additionalTextEdits).toMatchObject([{ newText: "\n\nuse Exception;" }]);
    expect(complete("<?php class Child extends Final", CATALOG)).toEqual([]);
  });

  it("offers interfaces after implements and uses a short same-namespace reference", () => {
    const items = complete("<?php namespace App; class Child implements Local", CATALOG);

    expect(items.map(({ label }) => label)).toEqual(["LocalContract"]);
    expect(items[0]?.textEdit).toMatchObject({ newText: "LocalContract" });
    expect(complete("<?php class Child implements Ex", CATALOG)).toEqual([]);
  });

  it("offers final classes in ordinary type positions", () => {
    const items = complete("<?php function make(): Final", CATALOG);

    expect(items.map(({ label }) => label)).toEqual(["FinalBase"]);
    expect(items[0]?.detail).toContain("Composer dependency");
  });

  it("reuses existing imports and aliases instead of inserting qualified names", () => {
    const imported = complete(
      "<?php\nnamespace App;\n\nuse Vendor\\Contracts\\Repository;\n\nclass Service { public Repo",
      CATALOG,
    );
    const aliased = complete(
      "<?php\nnamespace App;\n\nuse Vendor\\Contracts\\Repository as Store;\n\nclass Service { public Sto",
      CATALOG,
    );

    expect(imported[0]).toMatchObject({
      label: "Repository",
      textEdit: { newText: "Repository" },
      additionalTextEdits: undefined,
    });
    expect(aliased[0]).toMatchObject({
      label: "Store",
      textEdit: { newText: "Store" },
      additionalTextEdits: undefined,
    });
  });

  it("keeps a qualified completion when the short name would collide", () => {
    const items = complete(
      "<?php\nnamespace App;\n\nuse Other\\Product;\n\nclass Service { public Pro",
      CATALOG,
    );

    expect(items[0]).toMatchObject({
      label: "Product",
      textEdit: { newText: "\\Vendor\\Domain\\Product" },
      additionalTextEdits: undefined,
    });
  });

  it("adds an unimported type according to the configured import order", () => {
    const source =
      "<?php\nnamespace App;\n\nuse Vendor\\Domain\\Product;\n\nclass Service { public Repo";
    const alphabetic = complete(source, CATALOG, "alphabetic")[0];
    const unsorted = complete(source, CATALOG, "none")[0];

    expect(alphabetic).toMatchObject({
      textEdit: { newText: "Repository" },
      additionalTextEdits: [{ newText: "use Vendor\\Contracts\\Repository;\n" }],
    });
    expect(unsorted).toMatchObject({
      textEdit: { newText: "Repository" },
      additionalTextEdits: [{ newText: "\nuse Vendor\\Contracts\\Repository;" }],
    });
  });

  it("places a completion import after a leading declare statement", () => {
    const source = "<?php\ndeclare(strict_types=1);\n\nfunction make(): Pro";
    const item = complete(source, CATALOG)[0];
    const insertion = item?.additionalTextEdits?.[0];

    expect(item?.textEdit).toMatchObject({ newText: "Product" });
    expect(insertion).toMatchObject({ newText: "\n\nuse Vendor\\Domain\\Product;" });
    expect(insertion?.range.start).toEqual(
      TextDocument.create("file:///workspace/Example.ppphp", "ppphp", 1, source).positionAt(
        source.indexOf(";") + 1,
      ),
    );
  });
});

function complete(
  source: string,
  catalog: readonly TypeCatalogEntry[],
  importSorting: "alphabetic" | "length" | "none" = "alphabetic",
) {
  const document = TextDocument.create("file:///workspace/Example.ppphp", "ppphp", 1, source);
  return typeCompletionsAt(document, document.positionAt(source.length), catalog, importSorting);
}

function type(
  name: string,
  namespace: string,
  kind: TypeCatalogEntry["kind"],
  origin: TypeCatalogEntry["origin"],
  final = false,
): TypeCatalogEntry {
  return {
    name,
    namespace,
    fqn: namespace === "" ? name : `${namespace}\\${name}`,
    kind,
    final,
    origin,
  };
}
