import { describe, expect, it, vi } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { checkDocument, parseEditorDiagnostics } from "../src/compiler-diagnostics.js";
import { executeCompiler } from "../src/compiler-process.js";

vi.mock("../src/compiler-process.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
    const projectFailure = parse({
      ...response(),
      diagnostics: [
        {
          code: "P6007",
          message: "Project issue",
          location: null,
          help: "Check the project cache.",
        },
      ],
    });
    expect(projectFailure.diagnostics).toEqual([]);
    expect(projectFailure.projectIssues).toEqual([
      { severity: 1, message: "P6007: Project issue\nHelp: Check the project cache." },
    ]);
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
    ).toThrow("invalid editor:diagnostics response");
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

  it("bounds encoded JSON independently of decoded buffer sizes", async () => {
    vi.mocked(executeCompiler).mockClear();
    const buffers = Array.from({ length: 4 }, (_, index) =>
      TextDocument.create(
        `file:///workspace/${index}.ppphp`,
        "ppphp",
        1,
        "\u0000".repeat(1024 * 1024),
      ),
    );
    const result = await checkDocument(
      buffers[0]!,
      "/workspace/0.ppphp",
      "/workspace",
      { enabled: true, timeoutMilliseconds: 1000 },
      buffers,
    );
    expect(result.unavailableReason).toContain("16 MiB");
    expect(executeCompiler).not.toHaveBeenCalled();
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

  it("forwards round cancellation and does not report an unavailable compiler", async () => {
    const controller = new AbortController();
    vi.mocked(executeCompiler).mockResolvedValue({
      stdout: "",
      stderr: "",
      notFound: false,
      cancelled: true,
    });
    const result = await checkDocument(
      document,
      "/workspace/a.ppphp",
      "/workspace",
      { enabled: true, timeoutMilliseconds: 1000 },
      [],
      controller.signal,
    );
    expect(vi.mocked(executeCompiler).mock.lastCall?.[5]).toBe(controller.signal);
    expect(result).toEqual({ diagnostics: [], cancelled: true });
  });

  it.each(["stdout", "stderr"] as const)(
    "reports memory exhaustion from %s without leaking the stack",
    async (stream) => {
      vi.mocked(executeCompiler).mockResolvedValue({
        stdout: "",
        stderr: "",
        notFound: false,
        exitCode: 255,
        [stream]:
          "PHP Fatal error: Allowed memory size of 536870912 bytes exhausted (tried to allocate 4096 bytes) in /private/project/Secret.php on line 17\nStack trace: private data",
      });
      const result = await checkDocument(
        document,
        "/workspace/a.ppphp",
        "/workspace",
        { enabled: true, timeoutMilliseconds: 1000 },
        [],
      );
      expect(result.unavailableReason).toContain("exhausted its 512 MiB memory limit");
      expect(result.unavailableReason).not.toMatch(/Secret|private|Update|Stack/);
    },
  );

  it.each([1, 2])("accepts valid diagnostic envelopes with exit code %s", async (exitCode) => {
    vi.mocked(executeCompiler).mockResolvedValue({
      stdout: JSON.stringify(response()),
      stderr: "",
      notFound: false,
      exitCode,
    });
    const result = await checkDocument(
      document,
      "/workspace/a.ppphp",
      "/workspace",
      { enabled: true, timeoutMilliseconds: 1000 },
      [],
    );
    expect(result.unavailableReason).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [{ exitCode: 255 }, "exited with code 255"],
    [{ signal: "SIGKILL" }, "terminated by SIGKILL"],
    [{ exitCode: 0 }, "returned no diagnostic response"],
  ])(
    "explains an unsuccessful process without blaming compiler compatibility",
    async (metadata, expected) => {
      vi.mocked(executeCompiler).mockResolvedValue({
        stdout: "",
        stderr: "private output",
        notFound: false,
        ...metadata,
      });
      const result = await checkDocument(
        document,
        "/workspace/a.ppphp",
        "/workspace",
        { enabled: true, timeoutMilliseconds: 1000 },
        [],
      );
      expect(result.unavailableReason).toContain(expected);
      expect(result.unavailableReason).not.toContain("private");
    },
  );
});
