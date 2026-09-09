import { beforeEach, describe, expect, it, vi } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { checkDocument, checkFile } from "../src/compiler-diagnostics.js";
import { resolveCompilerSymbolAt } from "../src/compiler-definition.js";
import { classifySemanticTokens } from "../src/compiler-semantic-tokens.js";
import { executeCompiler } from "../src/compiler-process.js";
import type * as CompilerProcess from "../src/compiler-process.js";

vi.mock("../src/compiler-process.js", async (importOriginal) => ({
  ...(await importOriginal<typeof CompilerProcess>()),
  executeCompiler: vi.fn(),
}));

describe("compiler memory configuration across editor features", () => {
  const document = TextDocument.create("file:///workspace/a.ppphp", "ppphp", 1, "<?php new A;");
  const settings = {
    enabled: true,
    compilerPath: "/compiler/ppphp",
    compilerMemoryLimitMegabytes: 1024,
    timeoutMilliseconds: 1000,
  };
  beforeEach(() => {
    vi.mocked(executeCompiler).mockReset().mockResolvedValue({
      stdout: "",
      stderr: "",
      notFound: false,
      failure: "fixture launch failure",
    });
  });

  it.each([
    [
      "live diagnostics",
      () => checkDocument(document, "/workspace/a.ppphp", "/workspace", settings, []),
    ],
    ["saved-file checks", () => checkFile("/workspace/a.ppphp", "/workspace", settings)],
    [
      "navigation and rename resolution",
      () =>
        resolveCompilerSymbolAt(
          document,
          { line: 0, character: 10 },
          "/workspace/a.ppphp",
          "/workspace",
          settings,
        ),
    ],
    [
      "semantic highlighting",
      () => classifySemanticTokens(document, "/workspace/a.ppphp", "/workspace", settings),
    ],
  ])("passes the configured limit to %s", async (_name, run) => {
    await run();
    expect(executeCompiler).toHaveBeenCalledOnce();
    const call = vi.mocked(executeCompiler).mock.lastCall!;
    expect(call[0]).toBe(settings.compilerPath);
    expect(call[6]).toBe(1024);
  });
});
