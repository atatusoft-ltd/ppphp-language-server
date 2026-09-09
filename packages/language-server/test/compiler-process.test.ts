import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compilerProcessEnvironment,
  compilerLaunchEnvironment,
  COMPILER_MEMORY_LIMIT_ENVIRONMENT_VARIABLE,
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
      expect(invocation.usesPhpRuntime).toBe(true);
      expect(invocation.arguments.slice(0, 2)).toEqual(["-d", "memory_limit=512M"]);
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
        "-d",
        "memory_limit=512M",
        "C:\\workspace with spaces\\vendor\\bin\\ppphp",
        "check",
        "C:\\workspace with spaces\\src\\Example.ppphp",
      ],
      compiler: "C:\\workspace with spaces\\vendor\\bin\\ppphp.bat",
      usesPhpRuntime: true,
      phpScript: "C:\\workspace with spaces\\vendor\\bin\\ppphp",
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

  it("resolves Windows PATH wrappers before selecting the PHP proxy", () => {
    const result = resolveCompilerInvocation(
      "ppphp",
      ["check"],
      "win32",
      { Path: "C:\\tools;C:\\Composer bin", PPPHP_COMPILER_MEMORY_LIMIT_MEGABYTES: "768" },
      (file) => ["C:\\Composer bin\\ppphp.bat", "C:\\Composer bin\\ppphp"].includes(file),
      undefined,
      "C:\\workspace",
      (file) => file === "C:\\Composer bin\\ppphp.bat",
    );
    expect(result.command).toBe("php.exe");
    expect(result.arguments).toEqual([
      "-d",
      "memory_limit=768M",
      "C:\\Composer bin\\ppphp",
      "check",
    ]);
  });

  it.each(["php", "phar"])(
    "uses the invocation cwd and configured limit for relative .%s paths",
    (extension) => {
      const result = resolveCompilerInvocation(
        `./tools/compiler.${extension}`,
        ["check", "space & name.ppphp"],
        "linux",
        { PPPHP_COMPILER_MEMORY_LIMIT_MEGABYTES: "768" },
        () => true,
        1024,
        "/workspace with spaces",
      );
      expect(result.arguments).toEqual([
        "-d",
        "memory_limit=1024M",
        `/workspace with spaces/tools/compiler.${extension}`,
        "check",
        "space & name.ppphp",
      ]);
    },
  );

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

  it.each([undefined, 256, 768])(
    "sets the real PHP limit for extensionless Composer scripts (%s)",
    async (limit) => {
      const root = mkdtempSync(path.join(tmpdir(), "ppphp-memory-"));
      try {
        const script = path.join(root, "ppphp");
        writeFileSync(
          script,
          '#!/usr/bin/env php\n<?php echo json_encode([ini_get("memory_limit"), getenv("PPPHP_COMPILER_MEMORY_LIMIT_MEGABYTES")]);\n',
        );
        const result = await executeCompiler(script, [], root, 5000, undefined, undefined, limit);
        expect(result.failure).toBeUndefined();
        expect(JSON.parse(result.stdout)).toEqual([`${limit ?? 512}M`, String(limit ?? 512)]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("isolates concurrent child limits from an inherited setting", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ppphp-memory-isolation-"));
    const key = COMPILER_MEMORY_LIMIT_ENVIRONMENT_VARIABLE;
    const previous = process.env[key];
    try {
      process.env[key] = "2048";
      const script = path.join(root, "compiler.php");
      writeFileSync(
        script,
        '<?php echo json_encode([ini_get("memory_limit"), getenv("PPPHP_COMPILER_MEMORY_LIMIT_MEGABYTES")]);',
      );
      const results = await Promise.all(
        [256, 768].map((limit) =>
          executeCompiler(script, [], root, 5000, undefined, undefined, limit),
        ),
      );
      expect(results.map((result) => JSON.parse(result.stdout))).toEqual([
        ["256M", "256"],
        ["768M", "768"],
      ]);
      expect(process.env[key]).toBe("2048");
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes per-child memory intent without changing the input environment", () => {
    const key = COMPILER_MEMORY_LIMIT_ENVIRONMENT_VARIABLE;
    const inherited = { PATH: "/bin", [key]: "1024" };
    expect(compilerLaunchEnvironment(undefined, inherited)[key]).toBe("1024");
    expect(compilerLaunchEnvironment(256, inherited)[key]).toBe("256");
    expect(compilerLaunchEnvironment(0, inherited)[key]).toBe("512");
    expect(compilerLaunchEnvironment(undefined, { [key]: "invalid" })[key]).toBe("512");
    expect(inherited).toEqual({ PATH: "/bin", [key]: "1024" });
  });

  it("replaces differently cased Windows memory settings with one canonical key", () => {
    const key = COMPILER_MEMORY_LIMIT_ENVIRONMENT_VARIABLE;
    const inherited = { Path: "C:\\PHP", [key.toLowerCase()]: "1024" };
    expect(compilerLaunchEnvironment(undefined, inherited, "win32")[key]).toBe("1024");
    const selected = compilerLaunchEnvironment(256, inherited, "win32");
    expect(selected).toEqual({ Path: "C:\\PHP", [key]: "256" });
    expect(inherited[key.toLowerCase()]).toBe("1024");
  });

  it("finds extensionless PHP scripts on PATH and follows symlinks", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ppphp-path-memory-"));
    try {
      const script = path.join(root, "compiler.php");
      const proxy = path.join(root, "ppphp");
      writeFileSync(script, '#!/usr/bin/env php\n<?php echo ini_get("memory_limit");');
      chmodSync(script, 0o755);
      symlinkSync(script, proxy);
      const result = resolveCompilerInvocation(
        "ppphp",
        ["check"],
        process.platform,
        { PATH: root },
        undefined,
        1024,
        root,
      );
      expect(result.phpScript).toBe(proxy);
      expect(result.arguments).toEqual(["-d", "memory_limit=1024M", proxy, "check"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "skips non-executable files and directories on PATH",
    () => {
      const root = mkdtempSync(path.join(tmpdir(), "ppphp-path-permissions-"));
      try {
        const blocked = path.join(root, "blocked");
        const directory = path.join(root, "directory");
        const valid = path.join(root, "valid");
        for (const folder of [blocked, directory, valid]) mkdirSync(folder);
        writeFileSync(path.join(blocked, "ppphp"), "<?php echo 'unintended compiler';");
        chmodSync(path.join(blocked, "ppphp"), 0o644);
        mkdirSync(path.join(directory, "ppphp"));
        const compiler = path.join(valid, "ppphp");
        writeFileSync(compiler, "#!/usr/bin/env php\n<?php echo 'real compiler';");
        chmodSync(compiler, 0o755);
        const invocation = resolveCompilerInvocation("ppphp", ["check"], process.platform, {
          PATH: [blocked, directory, valid].join(path.delimiter),
        });
        expect(invocation.phpScript).toBe(compiler);
        expect(invocation.arguments).toEqual(["-d", "memory_limit=512M", compiler, "check"]);

        // No executable match must not fall back to interpreting a same-named cwd file.
        const unresolved = resolveCompilerInvocation(
          "ppphp",
          ["check"],
          process.platform,
          { PATH: blocked },
          undefined,
          undefined,
          blocked,
        );
        expect(unresolved).toEqual({
          command: "ppphp",
          arguments: ["check"],
          compiler: "ppphp",
          usesPhpRuntime: false,
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("does not reinterpret a custom shell wrapper as PHP", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ppphp-wrapper-"));
    try {
      const wrapper = path.join(root, "ppphp");
      writeFileSync(wrapper, '#!/bin/sh\nexec php /custom/compiler "$@"\n');
      expect(resolveCompilerInvocation(wrapper, ["check"]).usesPhpRuntime).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
