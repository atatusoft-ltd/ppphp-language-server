import type { CompilerSettings } from "./compiler-diagnostics.js";

export const DEFAULT_SETTINGS: CompilerSettings = {
  enabled: true,
  timeoutMilliseconds: 10_000,
};

export function compilerSettingsFromConfiguration(configuration: unknown): CompilerSettings {
  const root = asRecord(configuration);
  const compiler = asRecord(root?.compiler);
  const diagnostics = asRecord(root?.diagnostics);
  const diagnosticCompiler = asRecord(diagnostics?.compiler);
  const configuredPath = compiler?.path;
  const enabled = diagnosticCompiler?.enabled;
  const timeout = diagnosticCompiler?.timeoutMilliseconds;

  return {
    compilerPath:
      typeof configuredPath === "string" && configuredPath.trim() !== ""
        ? configuredPath
        : undefined,
    enabled: typeof enabled === "boolean" ? enabled : DEFAULT_SETTINGS.enabled,
    timeoutMilliseconds:
      typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
        ? timeout
        : DEFAULT_SETTINGS.timeoutMilliseconds,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
