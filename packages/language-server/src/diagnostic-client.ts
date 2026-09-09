import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  compilerProcessEnvironment,
  executeCompiler,
  resolveCompilerInvocation,
  type CompilerExecutionResult,
  type CompilerInvocation,
} from "./compiler-process.js";
import { CompilerInstallationChanged, DiagnosticWorker } from "./diagnostic-worker.js";

interface ProjectWorker {
  identity: string;
  worker?: DiagnosticWorker;
  retryAt: number;
}

/** Bounded project workers; older/failed compilers retain the single-shot path. */
export class DiagnosticClient {
  private readonly projects = new Map<string, ProjectWorker>();
  private reaping: Promise<void> = Promise.resolve();
  private active = false;
  private generation = 0;

  readonly execute: typeof executeCompiler = async (
    command,
    args,
    cwd,
    timeout,
    input,
    signal,
    memoryLimitMegabytes,
  ) => {
    const cancelled: CompilerExecutionResult = {
      stdout: "",
      stderr: "",
      notFound: false,
      cancelled: true,
    };
    const generation = this.generation;
    const isCancelled = () => signal?.aborted || generation !== this.generation;
    if (isCancelled()) return cancelled;
    if (this.active)
      return {
        stdout: "",
        stderr: "",
        notFound: false,
        failure: "Diagnostic requests must be scheduled serially.",
      };
    this.active = true;
    try {
      await this.reaping;
      if (isCancelled()) return cancelled;
      const environment = compilerProcessEnvironment();
      const invocation = resolveCompilerInvocation(
        command,
        args,
        process.platform,
        environment,
        existsSync,
        memoryLimitMegabytes,
        cwd,
      );
      if (invocation.unavailableReason || input === undefined) {
        return await executeCompiler(
          command,
          args,
          cwd,
          timeout,
          input,
          signal,
          memoryLimitMegabytes,
        );
      }
      const identity = await workerIdentity(invocation, cwd, environment, timeout);
      if (isCancelled()) return cancelled;
      let project = this.projects.get(cwd);
      if (project && project.identity !== identity) {
        await project.worker?.stop();
        this.projects.delete(cwd);
        project = undefined;
      }
      if (!project) {
        // A global serial scheduler makes eviction safe; cap retained PHP heaps.
        if (this.projects.size >= 4) {
          const oldest = this.projects.keys().next().value!;
          await this.projects.get(oldest)?.worker?.stop();
          this.projects.delete(oldest);
        }
        project = { identity, retryAt: 0 };
      }
      this.projects.delete(cwd);
      this.projects.set(cwd, project);
      if (isCancelled()) return cancelled;
      for (let attempt = 0; attempt < 2 && Date.now() >= project.retryAt; attempt++) {
        try {
          if (project.worker?.ended) {
            await project.worker.stop();
            project.worker = undefined;
          }
          if (isCancelled()) return cancelled;
          project.worker ??= new DiagnosticWorker(invocation, cwd, environment, timeout);
          const output = await project.worker.request(input, timeout, signal);
          if (output === undefined || isCancelled()) return cancelled;
          return { stdout: output, stderr: "", notFound: false };
        } catch (error) {
          await project.worker?.stop();
          project.worker = undefined;
          if (isCancelled()) return cancelled;
          // The compiler owns its opaque build identity. Restart once without
          // duplicating its fingerprint algorithm or retrying an obsolete buffer.
          if (error instanceof CompilerInstallationChanged && attempt === 0) continue;
          // Avoid spawning an unsupported --server command on every keystroke.
          // Installation/settings changes reset this backoff immediately.
          project.retryAt = Date.now() + 30_000;
        }
      }
      if (isCancelled()) return cancelled;
      return await executeCompiler(
        command,
        args,
        cwd,
        timeout,
        input,
        signal,
        memoryLimitMegabytes,
      );
    } catch {
      if (isCancelled()) return cancelled;
      return await executeCompiler(
        command,
        args,
        cwd,
        timeout,
        input,
        signal,
        memoryLimitMegabytes,
      );
    } finally {
      this.active = false;
    }
  };

  reset(): Promise<void> {
    this.generation++;
    const retired = [...this.projects.values()];
    this.projects.clear();
    this.reaping = Promise.all([
      this.reaping,
      ...retired.map((project) => project.worker?.stop()),
    ]).then(() => undefined);
    return this.reaping;
  }
}

async function workerIdentity(
  invocation: CompilerInvocation,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeout: number,
): Promise<string> {
  const executable = await executablePath(invocation.command, cwd, environment);
  const compiler = invocation.usesPhpRuntime
    ? path.resolve(cwd, invocation.phpScript!)
    : executable;
  const files = new Set([executable, compiler]);
  // Composer proxies and symlinks can remain unchanged across package upgrades.
  // Include installation metadata for both the proxy and its physical target.
  for (const file of [compiler, await realpath(compiler).catch(() => compiler)]) {
    let directory = path.dirname(file);
    for (let depth = 0; depth < 8; depth++) {
      for (const name of [
        "composer.json",
        "composer.lock",
        "vendor/composer/installed.json",
        "vendor/composer/installed.php",
      ]) {
        files.add(path.join(directory, name));
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const stamps = await Promise.all(
    [...files].map(async (file) => {
      try {
        const physical = await realpath(file);
        const info = await stat(physical, { bigint: true });
        return [
          file,
          physical,
          String(info.dev),
          String(info.ino),
          String(info.size),
          String(info.mtimeNs),
          String(info.ctimeNs),
        ];
      } catch {
        return [file, "missing"];
      }
    }),
  );
  return createHash("sha256")
    .update(JSON.stringify([cwd, invocation, environment, timeout, stamps]))
    .digest("hex");
}

async function executablePath(
  command: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\"))
    return path.resolve(cwd, command);
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const extensions =
    process.platform === "win32" && !path.extname(command) ? [".exe", ".com", ""] : [""];
  for (const directory of (environment[pathKey] ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.resolve(cwd, directory, command + extension);
      if (
        await stat(candidate)
          .then((info) => info.isFile())
          .catch(() => false)
      )
        return candidate;
    }
  }
  return path.resolve(cwd, command);
}
