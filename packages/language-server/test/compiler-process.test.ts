import { describe, expect, it } from "vitest";
import {
  compilerProcessEnvironment,
  describeCompilerFailure,
  executeCompiler,
  resolveCompilerInvocation,
} from "../src/compiler-process.js";

describe("compiler process execution", () => {
  it("invokes Composer Windows batch wrappers through their PHP proxy without a shell", () => {
    const invocation = resolveCompilerInvocation(
      "C:\\workspace with spaces\\vendor\\bin\\ppphp.bat",
      ["check", "C:\\workspace with spaces\\src\\Example.ppphp"],
      "win32",
      { PPPHP_PHP_PATH: "C:\\PHP 8.4\\php.exe" },
      (candidate) => candidate.endsWith("vendor\\bin\\ppphp"),
    );

    expect(invocation).toEqual({
      command: "C:\\PHP 8.4\\php.exe",
      arguments: [
        "C:\\workspace with spaces\\vendor\\bin\\ppphp",
        "check",
        "C:\\workspace with spaces\\src\\Example.ppphp",
      ],
      compiler: "C:\\workspace with spaces\\vendor\\bin\\ppphp.bat",
      usesPhpRuntime: true,
    });
  });

  it("refuses a Windows batch wrapper without its argument-safe Composer proxy", () => {
    const invocation = resolveCompilerInvocation(
      "C:\\workspace\\vendor\\bin\\ppphp.bat",
      ["check"],
      "win32",
      {},
      () => false,
    );

    expect(invocation.unavailableReason).toContain("has no argument-safe Composer proxy");
  });

  it("keeps native executables argument based", () => {
    expect(
      resolveCompilerInvocation("C:\\tools\\ppphp.exe", ["check", "A&B.ppphp"], "win32"),
    ).toEqual({
      command: "C:\\tools\\ppphp.exe",
      arguments: ["check", "A&B.ppphp"],
      compiler: "C:\\tools\\ppphp.exe",
      usesPhpRuntime: false,
    });
  });

  it("reports a missing runtime instead of silently returning no diagnostics", async () => {
    const missing = `ppphp-missing-${process.pid}-${Date.now()}`;
    const result = await executeCompiler(missing, ["check"], process.cwd(), 1_000);

    expect(result.notFound).toBe(true);
    expect(result.failure).toContain(`Could not find the ++PHP compiler at ${missing}`);
  });

  it("does not treat a compiler diagnostic exit status as a launch failure", () => {
    const invocation = resolveCompilerInvocation("ppphp", ["check"]);

    expect(describeCompilerFailure({ code: 1 }, invocation, 5_000)).toBeUndefined();
  });

  it("reports a timed-out compiler even when the process has an exit status", () => {
    const invocation = resolveCompilerInvocation("ppphp", ["check"]);

    expect(describeCompilerFailure({ code: 1, killed: true }, invocation, 5_000)).toContain(
      "exceeded the 5000ms editor timeout",
    );
  });

  it("preserves a case-insensitive Windows Path variable", () => {
    const environment = compilerProcessEnvironment({ Path: "C:\\PHP;C:\\Node" }, "win32");

    expect(environment).toEqual({ Path: "C:\\PHP;C:\\Node" });
  });
});
