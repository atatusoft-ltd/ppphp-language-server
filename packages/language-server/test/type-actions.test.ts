import { TextDocument } from "vscode-languageserver-textdocument";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCompilerSymbolAt } from "../src/compiler-definition.js";
import { typeCodeActionsAt, type TypeActionCapabilities } from "../src/type-actions.js";
import {
  isTypeCompletionAt,
  typeImportCodeActionsAt,
  unresolvedTypeAt,
} from "../src/type-import.js";
import type { TypeCatalogEntry } from "../src/type-catalog.js";

vi.mock("../src/compiler-definition.js", () => ({ resolveCompilerSymbolAt: vi.fn() }));
const catalog: TypeCatalogEntry[] = ["Atatusoft", "Atatus"].map((namespace) => ({
  name: "DemoRunner",
  namespace,
  fqn: `${namespace}\\DemoRunner`,
  kind: "class",
  origin: "project",
  abstract: false,
  final: false,
  instantiable: true,
  attribute: false,
}));
const source = "<?php\nnamespace App;\n$runner = DemoRunner::create();\nDemoRunner $other;";
function input(text = source, name = "DemoRunner") {
  const document = TextDocument.create("file:///workspace/app.ppphp", "ppphp", 7, text);
  const position = document.positionAt(text.indexOf(name));
  return { document, range: { start: position, end: position } };
}
function actions(text = source, capabilities: TypeActionCapabilities = {}) {
  const { document, range } = input(text, text.includes("DemoRunner") ? "DemoRunner" : "Unknown");
  return typeCodeActionsAt(
    document,
    range,
    catalog,
    "/workspace/app.ppphp",
    "/workspace",
    { enabled: true, timeoutMilliseconds: 1000, importSorting: "alphabetic" },
    capabilities,
  );
}
beforeEach(() => {
  vi.mocked(resolveCompilerSymbolAt).mockReset().mockResolvedValue({ symbol: null });
});

describe("type action parity", () => {
  it.each([{}, { groupedImports: true, classCreation: true }])(
    "shortens the screenshot's generic qualified name for client %j",
    async (capabilities) => {
      const entry = {
        ...catalog[0]!,
        name: "Repository",
        namespace: "Atatusoft\\Showcase\\Contracts",
        fqn: "Atatusoft\\Showcase\\Contracts\\Repository",
        kind: "interface" as const,
      };
      const text = `<?php\nnamespace Atatusoft\\Showcase\\Infrastructure;\nclass InMemoryRepository<T> implements ${entry.fqn}<T> {}`;
      const document = TextDocument.create("file:///workspace/app.ppphp", "ppphp", 7, text);
      resolveType(entry.fqn);
      // The action must work throughout the qualified name, not just its basename.
      for (const segment of ["Atatusoft", "Showcase", "Contracts", "Repository"]) {
        const offset = text.indexOf(entry.fqn) + entry.fqn.indexOf(segment) + 2;
        const position = document.positionAt(offset);
        const result = await typeCodeActionsAt(
          document,
          { start: position, end: position },
          [entry],
          "/workspace/app.ppphp",
          "/workspace",
          { enabled: true, timeoutMilliseconds: 1000, importSorting: "alphabetic" },
          capabilities,
        );
        expect(result).toHaveLength(1);
        expect(result[0]?.title).toBe(`Use import for ${entry.fqn}`);
        expect(TextDocument.applyEdits(document, result[0]!.edit!.changes![document.uri]!)).toBe(
          `<?php\nnamespace Atatusoft\\Showcase\\Infrastructure;\n\nuse ${entry.fqn};\nclass InMemoryRepository<T> implements Repository<T> {}`,
        );
      }
    },
  );

  it.each([
    ["<?php\nnew Atatusoft\\DemoRunner();", "Atatusoft\\DemoRunner"],
    ["<?php\nnamespace Atatusoft;\nnew namespace\\DemoRunner();", "Atatusoft\\DemoRunner"],
    [
      "<?php\nnamespace App;\nuse Atatusoft as SDK;\nnew SDK\\DemoRunner();",
      "Atatusoft\\DemoRunner",
    ],
    [
      "<?php\nnamespace App;\nuse Vendor\\{Contracts as SDK};\nnew SDK\\DemoRunner();",
      "Vendor\\Contracts\\DemoRunner",
    ],
    ["<?php\nnamespace App;\nnew Atatusoft\\DemoRunner();", "App\\Atatusoft\\DemoRunner"],
  ])("uses compiler identity for qualified reference in %s", async (text, fqn) => {
    const entry = { ...catalog[0]!, fqn, namespace: fqn.slice(0, fqn.lastIndexOf("\\")) };
    resolveType(fqn);
    const { document, range } = input(text);
    const result = await typeCodeActionsAt(
      document,
      range,
      [...catalog.filter((candidate) => candidate.fqn !== fqn), entry],
      "/workspace/app.ppphp",
      "/workspace",
      { enabled: true, timeoutMilliseconds: 1000, importSorting: "alphabetic" },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe(`Use import for ${fqn}`);
    const edited = TextDocument.applyEdits(document, result[0]!.edit!.changes![document.uri]!);
    expect(edited).toContain("new DemoRunner();");
    if (entry.namespace !== "Atatusoft" || !text.includes("namespace Atatusoft;"))
      expect(edited).toContain(`use ${fqn};`);
  });

  it("reuses aliases and refuses short-name collisions for qualified types", async () => {
    resolveType("Atatusoft\\DemoRunner");
    const aliased =
      "<?php\nnamespace App;\nuse Atatusoft\\DemoRunner as Runner;\nnew Atatusoft\\DemoRunner();";
    // Select the use site rather than the existing import.
    const document = TextDocument.create("file:///workspace/app.ppphp", "ppphp", 7, aliased);
    const position = document.positionAt(aliased.lastIndexOf("DemoRunner"));
    const result = await typeCodeActionsAt(
      document,
      { start: position, end: position },
      catalog,
      "/workspace/app.ppphp",
      "/workspace",
      { enabled: true, timeoutMilliseconds: 1000, importSorting: "alphabetic" },
    );
    expect(result[0]?.edit?.changes?.[document.uri]).toHaveLength(1);
    expect(TextDocument.applyEdits(document, result[0]!.edit!.changes![document.uri]!)).toContain(
      "new Runner();",
    );
    expect(
      await actions("<?php namespace App; new Atatusoft\\DemoRunner(); class DemoRunner {}"),
    ).toEqual([]);
  });

  it("fails closed for unresolved, unavailable, non-type, or uncatalogued qualified symbols", async () => {
    const text = "<?php namespace App; new Atatusoft\\DemoRunner();";
    expect(await actions(text, { classCreation: true })).toEqual([]);
    vi.mocked(resolveCompilerSymbolAt).mockResolvedValue({
      symbol: null,
      unavailableReason: "Unavailable",
    });
    expect(await actions(text)).toEqual([]);
    resolveType("Missing\\DemoRunner");
    expect(await actions(text)).toEqual([]);
    vi.mocked(resolveCompilerSymbolAt).mockResolvedValue({
      symbol: {
        symbolId: "type-parameter:DemoRunner",
        kind: "typeParameter",
        filePath: "/workspace/app.ppphp",
        range: { start: 0, end: 1 },
        selectionRange: { start: 0, end: 1 },
      },
    });
    expect(await actions(text)).toEqual([]);
  });

  it("keeps absolute-name imports independent of compiler availability", async () => {
    expect(await actions("<?php namespace App; new \\Atatusoft\\DemoRunner();")).toHaveLength(1);
    expect(resolveCompilerSymbolAt).not.toHaveBeenCalled();
  });

  it("scans long declaration headers without exponential identifier backtracking", () => {
    const text = `<?php class Example { public function ${"longName".repeat(20)}($value = DemoRunner::create()) {}`;
    const start = text.indexOf("DemoRunner");
    const before = performance.now();
    expect(isTypeCompletionAt(text, start, start + "DemoRunner".length)).toBe(true);
    expect(performance.now() - before).toBeLessThan(1000);
    // This non-type suffix used to make the nested identifier repetition explode.
    const expression = `<?php class Example { public ${"LongType".repeat(20)} $value = candidate`;
    const candidate = expression.indexOf("candidate");
    expect(isTypeCompletionAt(expression, candidate, expression.length)).toBe(false);
    expect(performance.now() - before).toBeLessThan(1000);
  });
  it("offers every namespace candidate without silently preferring one", async () => {
    const result = await actions();
    expect(result.map((action) => action.title)).toEqual([
      "Import class Atatusoft\\DemoRunner",
      "Import class Atatus\\DemoRunner",
    ]);
    expect(result.every((action) => action.isPreferred === false)).toBe(true);
    expect(result[0]?.edit?.changes?.[input().document.uri]?.[1]?.newText).toContain(
      "use Atatusoft\\DemoRunner;",
    );
  });
  it("groups the same edits for a native chooser and gates creation on client support", async () => {
    const flat = await actions();
    const grouped = await actions(source, { groupedImports: true, classCreation: true });
    expect(grouped.map((action) => action.title)).toEqual(["Import class", "Create class"]);
    expect(grouped[0]?.data.ppphp.choices).toEqual(flat);
    expect(grouped[1]?.data.ppphp).toEqual({
      kind: "createClass",
      name: "DemoRunner",
      namespace: "App",
      version: 7,
    });
    expect(
      await actions("<?php namespace App; new Unknown();", { classCreation: true }),
    ).toMatchObject([{ title: "Create class" }]);
  });
  it("does not offer imports or creation for compiler-resolved scoped symbols or unavailable analysis", async () => {
    vi.mocked(resolveCompilerSymbolAt).mockResolvedValue({
      symbol: {
        symbolId: "T",
        kind: "typeParameter",
        filePath: "/workspace/app.ppphp",
        range: { start: 0, end: 1 },
        selectionRange: { start: 0, end: 1 },
      },
    });
    expect(await actions(source, { classCreation: true })).toEqual([]);
    vi.mocked(resolveCompilerSymbolAt).mockResolvedValue({
      symbol: null,
      unavailableReason: "Compiler unavailable",
    });
    expect(await actions(source, { classCreation: true })).toEqual([]);
  });
  it("rejects existing imports, relative names, variables and builtin types", () => {
    for (const text of [
      "<?php use Vendor\\DemoRunner; DemoRunner::create();",
      "<?php $DemoRunner = 1;",
      "<?php new Vendor\\DemoRunner();",
      "<?php function test(string $value) {}",
    ]) {
      const { document, range } = input(text, text.includes("string") ? "string" : "DemoRunner");
      expect(unresolvedTypeAt(document, range, catalog)).toBeNull();
    }
  });
  it("offers Use import for both arms of a multiline catch union without requiring a diagnostic", () => {
    const text =
      "<?php namespace App; try {} catch (\n \\Atatusoft\\DemoRunner | \\Atatus\\DemoRunner $error\n) {}";
    const { document } = input(text);
    for (const entry of catalog) {
      const position = document.positionAt(text.indexOf(entry.fqn) + 4);
      const result = typeImportCodeActionsAt(document, { start: position, end: position }, catalog);
      expect(result).toHaveLength(1);
      expect(result[0]?.kind).toBe("refactor.rewrite");
      expect(result[0]?.title).toBe(`Use import for ${entry.fqn}`);
    }
  });
});

function resolveType(fqn: string) {
  vi.mocked(resolveCompilerSymbolAt).mockResolvedValue({
    symbol: {
      symbolId: `type:${fqn.toLowerCase()}`,
      kind: "class",
      filePath: "/workspace/type.ppphp",
      range: { start: 0, end: 1 },
      selectionRange: { start: 0, end: 1 },
    },
  });
}
