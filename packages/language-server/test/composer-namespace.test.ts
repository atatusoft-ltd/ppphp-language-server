import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inferComposerNamespace, resolveComposerNamespace } from "../src/composer-namespace.js";

describe("Composer namespace inference", () => {
  it("prefers preserved production and development source mappings", async () => {
    const source = JSON.stringify({
      autoload: { "psr-4": { "Runtime\\": "build/ppphp/" } },
      extra: {
        ppphp: {
          "source-autoload": { "psr-4": { "My\\App\\": ["src/", "legacy/"] } },
          "source-autoload-dev": { "psr-4": { "My\\Tests\\": "tests/" } },
        },
      },
    });

    await expect(infer(source, "src/Store")).resolves.toEqual({
      namespace: "My\\App\\Store",
      authoritative: true,
    });
    await expect(infer(source, "legacy/Model")).resolves.toEqual({
      namespace: "My\\App\\Model",
      authoritative: true,
    });
    await expect(infer(source, "tests/Unit")).resolves.toEqual({
      namespace: "My\\Tests\\Unit",
      authoritative: true,
    });
  });

  it("uses the most specific root and declines ambiguous equal roots", async () => {
    const specific = JSON.stringify({
      extra: {
        ppphp: {
          "source-autoload": {
            "psr-4": {
              "My\\App\\": "src/",
              "My\\App\\Generated\\": "src/Generated/",
            },
          },
        },
      },
    });
    await expect(infer(specific, "src/Generated/Api")).resolves.toEqual({
      namespace: "My\\App\\Generated\\Api",
      authoritative: true,
    });

    const ambiguous = JSON.stringify({
      extra: {
        ppphp: {
          "source-autoload": { "psr-4": { "My\\App\\": "src/" } },
          "source-autoload-dev": { "psr-4": { "My\\Tests\\": "src/" } },
        },
      },
    });
    await expect(infer(ambiguous, "src/Store")).resolves.toEqual({
      namespace: null,
      authoritative: true,
    });
  });

  it("falls back to ordinary Composer mappings and supports parent-relative roots", async () => {
    const runtime = JSON.stringify({
      autoload: { "psr-4": { "My\\App\\": "src/" } },
      "autoload-dev": { "psr-4": { "My\\Tests\\": ["tests/"] } },
    });
    await expect(infer(runtime, "src/Store")).resolves.toEqual({
      namespace: "My\\App\\Store",
      authoritative: true,
    });

    const shared = JSON.stringify({
      extra: {
        ppphp: { "source-autoload": { "psr-4": { "Shared\\": "../shared/src/" } } },
      },
    });
    await expect(
      inferComposerNamespace(
        shared,
        path.join(path.sep, "workspace", "package"),
        path.join(path.sep, "workspace", "shared", "src", "Model"),
        lexicalCanonicalizer,
      ),
    ).resolves.toEqual({ namespace: "Shared\\Model", authoritative: true });
  });

  it("uses the nearest Composer package for a real directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppphp-namespace-"));

    try {
      const target = path.join(root, "packages", "feature", "src", "Domain");
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(
        path.join(root, "composer.json"),
        JSON.stringify({ autoload: { "psr-4": { "Root\\": "src/" } } }),
      );
      await fs.writeFile(
        path.join(root, "packages", "feature", "composer.json"),
        JSON.stringify({ autoload: { "psr-4": { "Feature\\": "src/" } } }),
      );

      await expect(resolveComposerNamespace(target)).resolves.toEqual({
        namespace: "Feature\\Domain",
        authoritative: true,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("matches mapping roots through canonical filesystem identity", async () => {
    const source = JSON.stringify({
      extra: {
        ppphp: { "source-autoload": { "psr-4": { "My\\App\\": "src/" } } },
      },
    });
    const canonicalize = async (candidate: string): Promise<string> =>
      path.resolve(candidate).replace(`${path.sep}src`, `${path.sep}Src`);

    await expect(
      inferComposerNamespace(
        source,
        path.join(path.sep, "project"),
        path.join(path.sep, "project", "Src", "Store"),
        canonicalize,
      ),
    ).resolves.toEqual({ namespace: "My\\App\\Store", authoritative: true });
  });

  it("ignores malformed metadata and invalid namespace suffixes", async () => {
    await expect(infer("not json", "src/Store")).resolves.toEqual({
      namespace: null,
      authoritative: false,
    });
    const source = JSON.stringify({
      extra: {
        ppphp: { "source-autoload": { "psr-4": { "My\\App\\": "src/" } } },
      },
    });
    await expect(infer(source, "src/invalid-name")).resolves.toEqual({
      namespace: null,
      authoritative: false,
    });
  });
});

function infer(source: string, relativeTarget: string) {
  return inferComposerNamespace(
    source,
    path.join(path.sep, "project"),
    path.join(path.sep, "project", relativeTarget),
    lexicalCanonicalizer,
  );
}

async function lexicalCanonicalizer(candidate: string): Promise<string> {
  return path.resolve(candidate);
}
