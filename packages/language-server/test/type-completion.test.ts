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
  type("AbstractProduct", "Vendor\\Domain", "class", "dependency", false, true),
  type("Closure", "", "class", "php-runtime", false, false, false),
  type("Route", "Vendor\\Attributes", "class", "dependency", false, false, true, true),
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

  it("keeps a same-namespace type qualified when its short name is an imported alias", () => {
    const items = complete(
      "<?php namespace App; use Vendor\\LocalContract; class Child implements Local",
      CATALOG,
    );

    expect(items[0]).toMatchObject({
      label: "LocalContract",
      textEdit: { newText: "\\App\\LocalContract" },
      additionalTextEdits: undefined,
    });
  });

  it("offers final classes in ordinary type positions", () => {
    const items = complete("<?php function make(): Final", CATALOG);

    expect(items.map(({ label }) => label)).toEqual(["FinalBase"]);
    expect(items[0]?.detail).toContain("Composer dependency");
  });

  it("offers only instantiable classes after new", () => {
    expect(complete("<?php function make() { return new Pro", CATALOG)[0]?.label).toBe("Product");
    expect(complete("<?php function make() { return new Abs", CATALOG)).toEqual([]);
    expect(complete("<?php function make() { return new Json", CATALOG)).toEqual([]);
    expect(complete("<?php function make() { return new Clo", CATALOG)).toEqual([]);
  });

  it("does not offer type imports in ordinary expression positions", () => {
    expect(complete("<?php function run() { return Pro", CATALOG)).toEqual([]);
    expect(complete("<?php function run() { Pro", CATALOG)).toEqual([]);
    expect(complete("<?php #[Example(1, Pro", CATALOG)).toEqual([]);
  });

  it("does not treat commas inside parameter defaults as parameter separators", () => {
    expect(complete("<?php function run($value = [1, Pro", CATALOG)).toEqual([]);
    expect(complete("<?php function run($value = nested(1, Pro", CATALOG)).toEqual([]);
    expect(complete("<?php function run($value = [1, 2], Pro", CATALOG)[0]?.label).toBe("Product");
    expect(complete("<?php function run($value = nested(1, 2), Pro", CATALOG)[0]?.label).toBe(
      "Product",
    );
  });

  it("offers types in incomplete declarations and generic arguments", () => {
    expect(complete("<?php class Service { public Pro", CATALOG)[0]?.label).toBe("Product");
    expect(complete("<?php function run(Pro", CATALOG)[0]?.label).toBe("Product");
    expect(complete("<?php function run(): Repository<Pro", CATALOG)[0]?.label).toBe("Product");
    expect(complete("<?php #[Rou", CATALOG)[0]?.label).toBe("Route");
  });

  it("offers only known attribute classes in attribute name positions", () => {
    expect(complete("<?php #[Json", CATALOG)).toEqual([]);
    expect(complete("<?php #[Pro", CATALOG)).toEqual([]);
    expect(complete("<?php #[Rou", CATALOG)[0]).toMatchObject({
      label: "Route",
      textEdit: { newText: "Route" },
    });
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
      additionalTextEdits: [{ newText: "use Vendor\\Contracts\\Repository;\n" }],
    });
  });

  it("keeps a qualified completion when an unimported short type is already referenced", () => {
    const items = complete(
      "<?php\nnamespace App;\n\nclass Service { private Collection<Product> $current; public function make(): Pro",
      CATALOG,
    );

    expect(items[0]).toMatchObject({
      label: "Product",
      textEdit: { newText: "\\Vendor\\Domain\\Product" },
      additionalTextEdits: undefined,
    });
  });

  it("keeps a qualified completion when a relative type uses the same first segment", () => {
    const items = complete(
      "<?php\nnamespace App;\n\nclass Service { private Product\\Service $current; public function make(): Pro",
      CATALOG,
    );

    expect(items[0]).toMatchObject({
      label: "Product",
      textEdit: { newText: "\\Vendor\\Domain\\Product" },
      additionalTextEdits: undefined,
    });
  });

  it("does not treat the completion target as a pre-existing short reference", () => {
    const item = complete("<?php namespace App; function make(): Product", CATALOG)[0];

    expect(item).toMatchObject({
      textEdit: { newText: "Product" },
      additionalTextEdits: [{ newText: "\n\nuse Vendor\\Domain\\Product;" }],
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
  abstract = false,
  instantiable = kind === "class" && !abstract,
  attribute = false,
): TypeCatalogEntry {
  return {
    name,
    namespace,
    fqn: namespace === "" ? name : `${namespace}\\${name}`,
    kind,
    abstract,
    final,
    instantiable,
    attribute,
    origin,
  };
}
