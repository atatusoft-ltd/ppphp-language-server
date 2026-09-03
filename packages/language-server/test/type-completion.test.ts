import { TextDocument } from "vscode-languageserver-textdocument";
import { describe, expect, it } from "vitest";
import type { TypeCatalogEntry } from "../src/type-catalog.js";
import { typeCompletionsAt } from "../src/type-completion.js";

const CATALOG: TypeCatalogEntry[] = [
  type("Exception", "", "class", "php-runtime"),
  type("FinalBase", "Vendor", "class", "dependency", true),
  type("JsonSerializable", "", "interface", "php-runtime"),
  type("LocalContract", "App", "interface", "project"),
];

describe("type completion", () => {
  it("offers only inheritable classes after a class extends clause", () => {
    const items = complete("<?php namespace App; class Child extends Ex", CATALOG);

    expect(items.map(({ label }) => label)).toEqual(["Exception"]);
    expect(items[0]?.textEdit).toMatchObject({ newText: "\\Exception" });
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
});

function complete(source: string, catalog: readonly TypeCatalogEntry[]) {
  const document = TextDocument.create("file:///workspace/Example.ppphp", "ppphp", 1, source);
  return typeCompletionsAt(document, document.positionAt(source.length), catalog);
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
