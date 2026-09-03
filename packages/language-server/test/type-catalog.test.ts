import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getTypeCatalog,
  invalidateTypeCatalog,
  parseTypeDeclarations,
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
final readonly class Closed {}
class Open {}
interface Contract {}
trait Shared {}
enum State {}
`,
      "project",
    );

    expect(declarations).toEqual([
      entry("Closed", "class", true),
      entry("Open", "class"),
      entry("Contract", "interface"),
      entry("Shared", "trait"),
      entry("State", "enum"),
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
});

function entry(name: string, kind: "class" | "interface" | "trait" | "enum", final = false) {
  return {
    name,
    namespace: "App\\Domain",
    fqn: `App\\Domain\\${name}`,
    kind,
    final,
    origin: "project",
  };
}
