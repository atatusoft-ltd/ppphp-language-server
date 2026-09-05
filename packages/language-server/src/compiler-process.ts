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
  failure?: string;
}

export interface CompilerInvocation {
  command: string;
  arguments: string[];
  compiler: string;
  usesPhpRuntime: boolean;
  unavailableReason?: string;
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
    const environment = compilerProcessEnvironment();
    const invocation = resolveCompilerInvocation(command, args, process.platform, environment);
    if (invocation.unavailableReason) {
      resolve({
        stdout: "",
        stderr: "",
        notFound: false,
        failure: invocation.unavailableReason,
      });
      return;
    }

    let child;
    try {
      child = execFile(
        invocation.command,
        invocation.arguments,
        {
          cwd,
          encoding: "utf8",
          env: environment,
          maxBuffer: 10 * 1024 * 1024,
          timeout: timeoutMilliseconds,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const code = error && "code" in error ? error.code : undefined;
          const notFound = code === "ENOENT";
          resolve({
            stdout,
            stderr,
            notFound,
            failure: describeCompilerFailure(error, invocation, timeoutMilliseconds),
          });
        },
      );
    } catch (error) {
      resolve({
        stdout: "",
        stderr: "",
        notFound: false,
        failure: describeCompilerFailure(error, invocation, timeoutMilliseconds),
      });
      return;
    }

    if (input !== undefined) {
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(input);
    }
  });
}

export function resolveCompilerInvocation(
  compiler: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  fileExists: (candidate: string) => boolean = existsSync,
): CompilerInvocation {
  const extension = path.extname(compiler).toLowerCase();
  const isWindowsScript = platform === "win32" && (extension === ".bat" || extension === ".cmd");
  const isPhpScript = extension === ".php" || extension === ".phar";

  if (!isWindowsScript && !isPhpScript) {
    return {
      command: compiler,
      arguments: [...args],
      compiler,
      usesPhpRuntime: false,
    };
  }

  const script = isWindowsScript ? compiler.slice(0, -extension.length) : compiler;
  if (!fileExists(script)) {
    return {
      command: compiler,
      arguments: [...args],
      compiler,
      usesPhpRuntime: isPhpScript,
      unavailableReason: isWindowsScript
        ? `The ++PHP batch wrapper has no argument-safe Composer proxy at ${script}. Reinstall the project's Composer dependencies.`
        : `The configured ++PHP compiler does not exist: ${script}`,
    };
  }

  const configuredPhp = environment.PPPHP_PHP_PATH?.trim();
  return {
    command: configuredPhp || (platform === "win32" ? "php.exe" : "php"),
    arguments: [script, ...args],
    compiler,
    usesPhpRuntime: true,
  };
}

export function describeCompilerFailure(
  error: unknown,
  invocation: CompilerInvocation,
  timeoutMilliseconds: number,
): string | undefined {
  if (!error || typeof error !== "object") return undefined;

  const code = "code" in error ? error.code : undefined;
  if ("killed" in error && error.killed === true) {
    return `The ++PHP compiler exceeded the ${timeoutMilliseconds}ms editor timeout.`;
  }
  if (typeof code === "number") return undefined;
  if (code === "ENOENT") {
    return invocation.usesPhpRuntime
      ? `Could not find the PHP runtime at ${invocation.command}. Set PPPHP_PHP_PATH to an absolute PHP executable path.`
      : `Could not find the ++PHP compiler at ${invocation.compiler}. Configure ppphp.compiler.path or add ppphp to PATH.`;
  }

  const suffix = typeof code === "string" && code !== "" ? ` (${code})` : "";
  return `The ++PHP compiler process could not be started${suffix}.`;
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
