import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { afterEach, describe, expect, it } from "vitest";
import {
  getTypeCatalog,
  invalidateTypeCatalog,
  parseTypeDeclarations,
  updateTypeCatalogDocument,
} from "../src/type-catalog.js";

afterEach(() => invalidateTypeCatalog());

describe("type catalog", () => {
  it("classifies namespaced source declarations without reading comments or strings", () => {
    const declarations = parseTypeDeclarations(
      `<?php
namespace App\\Domain;
// final class Decoy {}
$text = 'interface AlsoDecoy {}';
$anonymous = new class extends Open {};
$attributedAnonymous = new #[Example] class extends Open {};
$nestedAttributedAnonymous = new #[Example([1, [2]])] #[Other(name: [Open::class])] class extends Open {};
$attributedReadonlyAnonymous = new #[Example([1, [2]])] readonly class extends Open {};
$configured = configure(class: Missing::class);
#[Metadata\\Final] class AttributeNamedFinal {}
#[Metadata\\Abstract] class AttributeNamedAbstract {}
final readonly class Closed {}
abstract class AbstractModel {}
class Open {}
interface Contract {}
trait Shared {}
enum State {}
`,
      "project",
    );

    expect(declarations).toEqual([
      entry("AttributeNamedFinal", "class"),
      entry("AttributeNamedAbstract", "class"),
      entry("Closed", "class", true),
      entry("AbstractModel", "class", false, true),
      entry("Open", "class"),
      entry("Contract", "interface"),
      entry("Shared", "trait"),
      entry("State", "enum"),
    ]);
  });

  it("recognizes only declaration namespaces and preserves their spelling", () => {
    const declarations = parseTypeDeclarations(
      `<?php
namespace App\\Domain;
$namespace = 'runtime';
$constant = Product::namespace;
class Product {}
`,
      "project",
    );

    expect(declarations).toEqual([entry("Product", "class")]);
  });

  it("identifies attribute classes through global and imported Attribute markers", () => {
    const declarations = parseTypeDeclarations(
      `<?php
namespace App;
use Attribute as AttributeMarker;
#[AttributeMarker] class ImportedAttribute {}
#[\\Attribute] class QualifiedAttribute {}
#[Other(Attribute::class)] class OrdinaryClass {}
`,
      "project",
    );

    expect(declarations.map(({ fqn, attribute }) => ({ fqn, attribute }))).toEqual([
      { fqn: "App\\ImportedAttribute", attribute: true },
      { fqn: "App\\QualifiedAttribute", attribute: true },
      { fqn: "App\\OrdinaryClass", attribute: false },
    ]);
  });

  it("discovers project and installed Composer package types", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-types-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "vendor", "composer"), { recursive: true });
    await mkdir(path.join(root, "vendor", "vendor-name", "library", "src"), {
      recursive: true,
    });
    await mkdir(path.join(root, "vendor", "vendor-name", "library", "src", "Tests"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "ppphp.json"),
      JSON.stringify({ source: ["src"], output: "build", cache: ".ppphp-cache" }),
    );
    await writeFile(
      path.join(root, "composer.json"),
      JSON.stringify({
        extra: { ppphp: { "source-autoload": { "psr-4": { "App\\": "src/" } } } },
      }),
    );
    await writeFile(path.join(root, "src", "Order.ppphp"), "<?php namespace App; class Order {}\n");
    await writeFile(
      path.join(root, "vendor", "composer", "installed.json"),
      JSON.stringify({
        packages: [
          {
            name: "vendor-name/library",
            "install-path": "../vendor-name/library",
            autoload: {
              "psr-4": { "Vendor\\Library\\": "src/" },
              "exclude-from-classmap": ["/src/Tests/"],
            },
            "autoload-dev": { "psr-4": { "Vendor\\Library\\Tests\\": "src/Tests/" } },
          },
        ],
      }),
    );
    await writeFile(
      path.join(root, "vendor", "vendor-name", "library", "src", "Clock.php"),
      "<?php namespace Vendor\\Library; interface Clock {}\n",
    );
    await writeFile(
      path.join(root, "vendor", "vendor-name", "library", "src", "Tests", "FakeClock.php"),
      "<?php namespace Vendor\\Library\\Tests; class FakeClock {}\n",
    );

    const catalog = await getTypeCatalog(root);

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "App\\Order", kind: "class", origin: "project" }),
        expect.objectContaining({
          fqn: "Vendor\\Library\\Clock",
          kind: "interface",
          origin: "dependency",
        }),
      ]),
    );
    expect(catalog).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "Vendor\\Library\\Tests\\FakeClock" }),
      ]),
    );
  });

  it("includes mixed PHP source and explicitly configured PHP stubs, but not generated output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-mixed-catalog-"));
    for (const directory of ["app", "stubs", "build"]) await mkdir(path.join(root, directory));
    await writeFile(
      path.join(root, "ppphp.json"),
      JSON.stringify({ source: ["app"], stubs: ["stubs"], output: "build" }),
    );
    await writeFile(path.join(root, "app", "Legacy.php"), "<?php namespace App; class Legacy {}");
    await writeFile(
      path.join(root, "stubs", "Other.stub.php"),
      "<?php namespace Other; class Legacy {}",
    );
    await writeFile(path.join(root, "build", "Generated.php"), "<?php class Generated {}");
    const catalog = await getTypeCatalog(root);
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "App\\Legacy", origin: "project" }),
        expect.objectContaining({ fqn: "Other\\Legacy", origin: "dependency" }),
      ]),
    );
    expect(catalog.some((entry) => entry.fqn === "Generated")).toBe(false);
  });

  it("discovers more project files than the rename operation permits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-large-types-"));
    const sourceRoot = path.join(root, "src");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(
      path.join(root, "ppphp.json"),
      JSON.stringify({ source: ["src"], output: "build", cache: ".ppphp-cache" }),
    );
    await Promise.all(
      Array.from({ length: 2_050 }, (_, index) =>
        writeFile(
          path.join(sourceRoot, `Type${index}.ppphp`),
          `<?php namespace App; class Type${index} {}\n`,
        ),
      ),
    );

    const catalog = await getTypeCatalog(root);

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "App\\Type2049", origin: "project" }),
      ]),
    );
  });

  it("discovers Composer path repositories through their installed symlink", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-linked-types-"));
    const packageRoot = path.join(root, "packages", "library");
    const installedRoot = path.join(root, "vendor", "vendor-name", "library");
    await mkdir(path.join(root, "vendor", "composer"), { recursive: true });
    await mkdir(path.join(root, "vendor", "vendor-name"), { recursive: true });
    await mkdir(path.join(packageRoot, "src"), { recursive: true });
    await writeFile(path.join(root, "composer.json"), "{}");
    await writeFile(
      path.join(root, "vendor", "composer", "installed.json"),
      JSON.stringify({
        packages: [
          {
            name: "vendor-name/library",
            "install-path": "../vendor-name/library",
            autoload: { "psr-4": { "Vendor\\Library\\": "src/" } },
          },
        ],
      }),
    );
    await writeFile(
      path.join(packageRoot, "src", "LinkedType.php"),
      "<?php namespace Vendor\\Library; class LinkedType {}\n",
    );
    await symlink(packageRoot, installedRoot, process.platform === "win32" ? "junction" : "dir");

    const catalog = await getTypeCatalog(root);

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "Vendor\\Library\\LinkedType", origin: "dependency" }),
      ]),
    );
  });

  it("replaces saved declarations with the contents of open documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-open-types-"));
    const sourcePath = path.join(root, "src", "Model.ppphp");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(
      path.join(root, "ppphp.json"),
      JSON.stringify({ source: ["src"], output: "build", cache: ".ppphp-cache" }),
    );
    await writeFile(sourcePath, "<?php namespace App; class OldModel {}\n");
    const openDocument = TextDocument.create(
      pathToFileURL(sourcePath).href,
      "ppphp",
      2,
      "<?php namespace App; class NewModel {}\n",
    );

    const catalog = await getTypeCatalog(root, [openDocument]);

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "App\\NewModel", origin: "project" }),
      ]),
    );
    expect(catalog).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "App\\OldModel", origin: "project" }),
      ]),
    );
  });

  it("replaces Composer-discovered project declarations with open documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-composer-open-types-"));
    const sourcePath = path.join(root, "src", "Model.ppphp");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(
      path.join(root, "composer.json"),
      JSON.stringify({ autoload: { "psr-4": { "App\\": "src/" } } }),
    );
    await writeFile(sourcePath, "<?php namespace App; class OldModel {}\n");
    const openDocument = TextDocument.create(
      pathToFileURL(sourcePath).href,
      "ppphp",
      2,
      "<?php namespace App; class NewModel {}\n",
    );

    const catalog = await getTypeCatalog(root, [openDocument]);

    expect(catalog.some(({ fqn }) => fqn === "App\\NewModel")).toBe(true);
    expect(catalog.some(({ fqn }) => fqn === "App\\OldModel")).toBe(false);
  });

  it("updates a saved project file without rebuilding the workspace catalog", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-saved-types-"));
    const sourcePath = path.join(root, "src", "Model.ppphp");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(
      path.join(root, "ppphp.json"),
      JSON.stringify({ source: ["src"], output: "build", cache: ".ppphp-cache" }),
    );
    await writeFile(sourcePath, "<?php namespace App; class OldModel {}\n");
    await getTypeCatalog(root);

    updateTypeCatalogDocument(root, sourcePath, "<?php namespace App; class NewModel {}\n");
    const catalog = await getTypeCatalog(root);

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "App\\NewModel", origin: "project" }),
      ]),
    );
    expect(catalog).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fqn: "App\\OldModel", origin: "project" }),
      ]),
    );
  });
});

function entry(
  name: string,
  kind: "class" | "interface" | "trait" | "enum",
  final = false,
  abstract = false,
) {
  return {
    name,
    namespace: "App\\Domain",
    fqn: `App\\Domain\\${name}`,
    kind,
    abstract,
    final,
    instantiable: kind === "class" && !abstract,
    attribute: false,
    origin: "project",
  };
}
