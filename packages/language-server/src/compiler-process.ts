import { execFile, type ChildProcess } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";

export interface CompilerProcessSettings {
  compilerPath?: string;
  compilerMemoryLimitMegabytes?: number;
  timeoutMilliseconds: number;
}

export interface CompilerExecutionResult {
  stdout: string;
  stderr: string;
  notFound: boolean;
  failure?: string;
  cancelled?: boolean;
}

export interface CompilerInvocation {
  command: string;
  arguments: string[];
  compiler: string;
  usesPhpRuntime: boolean;
  phpScript?: string;
  unavailableReason?: string;
}

export const DEFAULT_COMPILER_MEMORY_LIMIT_MEGABYTES = 512;

export function compilerMemoryLimitMegabytes(
  value: unknown = Number(process.env.PPPHP_COMPILER_MEMORY_LIMIT_MEGABYTES),
): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2147483647
    ? value
    : DEFAULT_COMPILER_MEMORY_LIMIT_MEGABYTES;
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
  signal?: AbortSignal,
  memoryLimitMegabytes?: number,
): Promise<CompilerExecutionResult> {
  return new Promise((resolve) => {
    const cancelled = { stdout: "", stderr: "", notFound: false, cancelled: true };
    if (signal?.aborted) {
      resolve(cancelled);
      return;
    }
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
    if (invocation.unavailableReason) {
      resolve({
        stdout: "",
        stderr: "",
        notFound: false,
        failure: invocation.unavailableReason,
      });
      return;
    }

    let child: ChildProcess | undefined;
    const abort = () => child?.kill();
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
          signal?.removeEventListener("abort", abort);
          if (signal?.aborted) {
            resolve(cancelled);
            return;
          }
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

    // execFile's callback runs after the child's streams close. Kill obsolete
    // work, but do not release the scheduler's single-flight slot before then.
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

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
  memoryLimitMegabytes?: number,
  cwd: string = process.cwd(),
  pathExecutable: (candidate: string) => boolean = (candidate) =>
    isExecutableFile(candidate, platform),
): CompilerInvocation {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const qualified = paths.isAbsolute(compiler) || compiler.includes("/") || compiler.includes("\\");
  const candidates = qualified
    ? [paths.resolve(cwd, compiler)]
    : (environment[pathKey] ?? "")
        .split(platform === "win32" ? ";" : ":")
        .filter(Boolean)
        .flatMap((directory) => {
          const base = paths.resolve(cwd, directory, compiler);
          return platform === "win32" && !paths.extname(compiler)
            ? [base + ".exe", base + ".com", base + ".bat", base + ".cmd", base]
            : [base];
        });
  // Explicit PHP paths need not have an executable bit, but PATH lookup must
  // skip non-executable files/directories just as normal process launch would.
  const located = qualified ? candidates[0] : candidates.find(pathExecutable);
  if (located === undefined) {
    return { command: compiler, arguments: [...args], compiler, usesPhpRuntime: false };
  }
  const extension = paths.extname(located).toLowerCase();
  const isWindowsScript = platform === "win32" && (extension === ".bat" || extension === ".cmd");
  const isPhpScript =
    extension === ".php" || extension === ".phar" || (extension === "" && isPhpSource(located));

  if (!isWindowsScript && !isPhpScript) {
    return {
      command: compiler,
      arguments: [...args],
      compiler,
      usesPhpRuntime: false,
    };
  }

  const script = isWindowsScript ? located.slice(0, -extension.length) : located;
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
    arguments: [
      "-d",
      `memory_limit=${compilerMemoryLimitMegabytes(
        memoryLimitMegabytes ?? Number(environment.PPPHP_COMPILER_MEMORY_LIMIT_MEGABYTES),
      )}M`,
      script,
      ...args,
    ],
    compiler,
    usesPhpRuntime: true,
    phpScript: script,
  };
}

function isExecutableFile(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Recognize Composer proxies/symlinks without treating arbitrary wrappers as PHP. */
function isPhpSource(file: string): boolean {
  let descriptor: number | undefined;
  try {
    if (!statSync(file).isFile()) return false;
    descriptor = openSync(file, "r");
    const buffer = Buffer.alloc(2048);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    return /^(?:#![^\r\n]*\r?\n)?\s*<\?php\b/.test(buffer.toString("utf8", 0, length));
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
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
