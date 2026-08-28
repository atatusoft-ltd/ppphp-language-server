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
              file: "src/example.phplus",
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
      "/workspace/src/example.phplus",
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
    expect(diagnostics[0]?.message).toContain("Try another declaration");
  });

  it("rejects unknown diagnostic envelope versions", () => {
    expect(() =>
      parseCompilerOutput('{"version":2,"diagnostics":[]}', "/a.phplus", "/"),
    ).toThrowError("unsupported diagnostic envelope");
  });
});
