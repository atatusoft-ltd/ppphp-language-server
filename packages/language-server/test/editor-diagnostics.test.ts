import { describe, expect, it, vi } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { checkDocument, parseEditorDiagnostics } from "../src/compiler-diagnostics.js";
import { executeCompiler } from "../src/compiler-process.js";

vi.mock("../src/compiler-process.js", () => ({
  executeCompiler: vi.fn(),
  resolveCompiler: () => "ppphp",
}));
const document = TextDocument.create(
  "file:///workspace/a.ppphp",
  "ppphp",
  7,
  "<?php\n// 🐘\nwrong;",
);
const response = () => ({
  version: 1,
  document: { path: "a.ppphp", version: 7 },
  diagnostics: [
    {
      message: "Unknown symbol",
      severity: "error",
      code: "P2000",
      location: { file: "a.ppphp", range: { start: { offset: 14 }, end: { offset: 19 } } },
    },
  ],
  analysis: { completeness: "compilerCore", fullParity: false, supplemental: false },
  error: null,
});
const parse = (value: unknown) =>
  parseEditorDiagnostics(JSON.stringify(value), document, "/workspace/a.ppphp", "/workspace");

describe("unsaved compiler diagnostics", () => {
  it("maps UTF-8 offsets and reports incomplete analyzer coverage", () => {
    const result = parse(response());
    expect(result.diagnostics[0]?.range).toEqual({
      start: { line: 2, character: 0 },
      end: { line: 2, character: 5 },
    });
    expect(result.coverageNote).toContain("compiler-core");
    expect(result.coverageNote).toContain("capability coverage is incomplete");
    expect(
      parse({ ...response(), analysis: { ...response().analysis, fullParity: true } }).coverageNote,
    ).toContain("without supplemental");
    expect(
      parse({ ...response(), diagnostics: [{ message: "Project issue", location: null }] })
        .diagnostics[0]?.range,
    ).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
  });

  it("refuses oversized buffers before spawning a compiler", async () => {
    vi.mocked(executeCompiler).mockClear();
    const large = TextDocument.create(document.uri, "ppphp", 8, "x".repeat(2 * 1024 * 1024 + 1));
    const result = await checkDocument(
      large,
      "/workspace/a.ppphp",
      "/workspace",
      { enabled: true, timeoutMilliseconds: 1000 },
      [],
    );
    expect(result.unavailableReason).toContain("2 MiB");
    expect(executeCompiler).not.toHaveBeenCalled();
  });

  it("rejects stale versions, wrong paths, protocol errors and unsupported coverage", () => {
    expect(() =>
      parseEditorDiagnostics("Unknown command", document, "/workspace/a.ppphp", "/workspace"),
    ).toThrow("Update the configured ++PHP compiler");
    expect(() => parse(null)).toThrow("Unsupported");
    expect(() => parse({ ...response(), version: 2 })).toThrow("Unsupported");
    expect(() => parse({ ...response(), document: { path: "a.ppphp", version: 6 } })).toThrow(
      "version",
    );
    expect(() => parse({ ...response(), document: { path: "b.ppphp", version: 7 } })).toThrow(
      "version",
    );
    expect(() =>
      parse({ ...response(), error: { message: "Not owned" }, document: null, analysis: null }),
    ).toThrow("Not owned");
    expect(() => parse({ ...response(), analysis: {} })).toThrow("coverage");
  });

  it("sends unsaved contents and other buffers via stdin without writing source files", async () => {
    vi.mocked(executeCompiler).mockResolvedValue({
      stdout: JSON.stringify(response()),
      stderr: "",
      notFound: false,
    });
    const other = TextDocument.create("file:///workspace/b.ppphp", "ppphp", 3, "<?php class B {}");
    const result = await checkDocument(
      document,
      "/workspace/a.ppphp",
      "/workspace",
      { enabled: true, timeoutMilliseconds: 1000 },
      [document, other],
    );
    expect(result.unavailableReason).toBeUndefined();
    const call = vi.mocked(executeCompiler).mock.lastCall!;
    expect(call[1]).toEqual([
      "editor:diagnostics",
      "--working-directory",
      "/workspace",
      "--format=json",
    ]);
    expect(JSON.parse(call[4]!)).toEqual({
      version: 1,
      document: { path: "/workspace/a.ppphp", version: 7, contents: document.getText() },
      overlays: [{ path: "/workspace/b.ppphp", contents: other.getText() }],
    });
  });

  it("honors disabled diagnostics and surfaces compiler failures", async () => {
    vi.mocked(executeCompiler).mockClear();
    expect(
      await checkDocument(
        document,
        "/workspace/a.ppphp",
        "/workspace",
        { enabled: false, timeoutMilliseconds: 1000 },
        [],
      ),
    ).toEqual({ diagnostics: [] });
    expect(executeCompiler).not.toHaveBeenCalled();
    vi.mocked(executeCompiler).mockResolvedValue({
      stdout: "",
      stderr: "",
      notFound: false,
      failure: "Timeout",
    });
    expect(
      (
        await checkDocument(
          document,
          "/workspace/a.ppphp",
          "/workspace",
          { enabled: true, timeoutMilliseconds: 1000 },
          [],
        )
      ).unavailableReason,
    ).toBe("Timeout");
  });
});
