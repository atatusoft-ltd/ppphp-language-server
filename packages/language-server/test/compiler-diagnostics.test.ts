import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { parseCompilerOutput } from "../src/compiler-diagnostics.js";

describe("compiler diagnostic mapping", () => {
  it("converts the versioned compiler envelope to LSP diagnostics", () => {
    const diagnostics = parseCompilerOutput(
      JSON.stringify({
        version: 1,
        diagnostics: [
          {
            code: "P1001",
            severity: "warning",
            title: "Example warning",
            message: "Something needs attention.",
            location: {
              file: "src/example.ppphp",
              range: {
                start: { offset: 6, line: 2, column: 3 },
                end: { offset: 9, line: 2, column: 6 },
              },
              label: "example",
            },
            related: [],
            help: "Try another declaration.",
          },
        ],
        summary: { errors: 0, warnings: 1, notes: 0 },
      }),
      "/workspace/src/example.ppphp",
      "/workspace",
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "P1001",
      severity: DiagnosticSeverity.Warning,
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 5 },
      },
      source: "++PHP",
    });
    expect(diagnostics[0]?.message).toBe(
      "Something needs attention.\nCategory: Example warning\nHelp: Try another declaration.",
    );
    expect(diagnostics[0]?.message).toContain("Try another declaration");
  });

  it("puts the actionable analyzer message on the first line", () => {
    const [diagnostic] = parseCompilerOutput(
      JSON.stringify({
        version: 1,
        diagnostics: [
          {
            code: "P2099",
            severity: "error",
            title: "Static Analysis Error",
            message: "Property Example::$value is never read, only written.",
            location: { file: "src/example.ppphp" },
            help: "Correct the reported type or symbol error.",
          },
        ],
      }),
      "/workspace/src/example.ppphp",
      "/workspace",
    );

    expect(diagnostic?.message).toBe(
      "Property Example::$value is never read, only written.\n" +
        "Category: Static Analysis Error\n" +
        "Help: Correct the reported type or symbol error.",
    );
  });

  it("rejects unknown diagnostic envelope versions", () => {
    expect(() =>
      parseCompilerOutput('{"version":2,"diagnostics":[]}', "/a.ppphp", "/"),
    ).toThrowError("unsupported diagnostic envelope");
  });
});
