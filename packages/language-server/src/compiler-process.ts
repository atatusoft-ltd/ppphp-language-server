import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface CompilerProcessSettings {
  compilerPath?: string;
  timeoutMilliseconds: number;
}

export interface CompilerExecutionResult {
  stdout: string;
  stderr: string;
  notFound: boolean;
}

export function resolveCompiler(configuredPath: string | undefined, workspaceRoot: string): string {
  if (configuredPath) return configuredPath;
  if (process.env.PPPHP_COMPILER_PATH) return process.env.PPPHP_COMPILER_PATH;

  const localCompiler = path.join(
    workspaceRoot,
    "vendor",
    "bin",
    process.platform === "win32" ? "ppphp.bat" : "ppphp",
  );

  return existsSync(localCompiler) ? localCompiler : "ppphp";
}

export function executeCompiler(
  command: string,
  args: string[],
  cwd: string,
  timeoutMilliseconds: number,
  input?: string,
): Promise<CompilerExecutionResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMilliseconds,
      },
      (error, stdout, stderr) => {
        const code = error && "code" in error ? error.code : undefined;
        resolve({
          stdout,
          stderr,
          notFound: code === "ENOENT",
        });
      },
    );

    if (input !== undefined) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    }
  });
}
