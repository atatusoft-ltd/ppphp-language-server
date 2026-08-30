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
        env: compilerProcessEnvironment(),
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

export function compilerProcessEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  directoryExists: (candidate: string) => boolean = existsSync,
): NodeJS.ProcessEnv {
  const result = { ...environment };
  const pathKey = Object.keys(result).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const delimiter = platform === "win32" ? ";" : ":";
  const configuredDirectories = (result[pathKey] ?? "").split(delimiter).filter(Boolean);
  const fallbackDirectories =
    platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]
      : platform === "win32"
        ? []
        : ["/usr/local/bin", "/usr/bin"];
  const seen = new Set<string>();
  const directories = [
    ...configuredDirectories,
    ...fallbackDirectories.filter(directoryExists),
  ].filter((directory) => {
    const identity = platform === "win32" ? directory.toLowerCase() : directory;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });

  result[pathKey] = directories.join(delimiter);
  return result;
}
