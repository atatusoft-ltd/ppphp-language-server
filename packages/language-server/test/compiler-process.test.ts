import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compilerProcessEnvironment,
  describeCompilerFailure,
  executeCompiler,
  resolveCompiler,
  resolveCompilerInvocation,
} from "../src/compiler-process.js";

describe("compiler discovery", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "ppphp-compiler-discovery-"));
    vi.stubEnv("PPPHP_COMPILER_PATH", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(workspace, { recursive: true, force: true });
  });

  it.each(["atatusoft-ltd/ppphp-src", "atatusoft/ppphp"])(
    "discovers the Composer proxy for %s without depending on the package directory",
    (packageName) => {
      const vendor = path.join(workspace, "vendor");
      const packageBin = path.join(vendor, packageName, "bin");
      const proxyBin = path.join(vendor, "bin");
      mkdirSync(packageBin, { recursive: true });
      mkdirSync(proxyBin, { recursive: true });
      writeFileSync(path.join(packageBin, "ppphp"), "<?php // Compiler fixture\n");
      writeFileSync(
        path.join(proxyBin, "ppphp"),
        `<?php require __DIR__ . '/../${packageName}/bin/ppphp';\n`,
      );
      const proxy = path.join(proxyBin, process.platform === "win32" ? "ppphp.bat" : "ppphp");
      if (process.platform === "win32") writeFileSync(proxy, '@php "%~dp0ppphp" %*\n');

      expect(resolveCompiler(undefined, workspace)).toBe(proxy);
      // Windows executes the extensionless Composer PHP proxy, not the batch shell.
      const invocation = resolveCompilerInvocation(proxy, ["--version"]);
      expect(invocation.unavailableReason).toBeUndefined();
      expect(invocation.compiler).toBe(proxy);
      expect(invocation.usesPhpRuntime).toBe(process.platform === "win32");
    },
  );

  it("preserves explicit configuration and environment override precedence", () => {
    const bin = path.join(workspace, "vendor", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, process.platform === "win32" ? "ppphp.bat" : "ppphp"), "");
    const environmentCompiler = path.join(workspace, "environment-compiler");
    const configuredCompiler = path.join(workspace, "configured-compiler");
    vi.stubEnv("PPPHP_COMPILER_PATH", environmentCompiler);

    expect(resolveCompiler(configuredCompiler, workspace)).toBe(configuredCompiler);
    expect(resolveCompiler(undefined, workspace)).toBe(environmentCompiler);
  });

  it("falls back to PATH when no project proxy or override exists", () => {
    expect(resolveCompiler(undefined, workspace)).toBe("ppphp");
  });
});

describe("compiler process execution", () => {
  it("does not launch already-cancelled work", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await executeCompiler(
      "missing-command",
      [],
      process.cwd(),
      5000,
      undefined,
      controller.signal,
    );
    expect(result).toEqual({ stdout: "", stderr: "", notFound: false, cancelled: true });
  });

  it("terminates an obsolete compiler without treating cancellation as a failure", async () => {
    const controller = new AbortController();
    const execution = executeCompiler(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      process.cwd(),
      5000,
      undefined,
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 20);
    try {
      expect(await execution).toEqual({ stdout: "", stderr: "", notFound: false, cancelled: true });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  });

  it("keeps completed output when the signal is aborted afterward", async () => {
    const controller = new AbortController();
    const result = await executeCompiler(
      process.execPath,
      ["-e", "console.log('done')"],
      process.cwd(),
      5000,
      undefined,
      controller.signal,
    );
    controller.abort();
    expect(result.stdout.trim()).toBe("done");
    expect(result.failure).toBeUndefined();
    expect(result.cancelled).toBeUndefined();
  });

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
