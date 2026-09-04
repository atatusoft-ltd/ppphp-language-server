import type { CompilerSettings } from "./compiler-diagnostics.js";

export type ImportSorting = "alphabetic" | "length" | "none";

export interface ServerSettings extends CompilerSettings {
  importSorting: ImportSorting;
}

export const DEFAULT_SETTINGS: ServerSettings = {
  enabled: true,
  importSorting: "alphabetic",
  timeoutMilliseconds: 10_000,
};

export function compilerSettingsFromConfiguration(configuration: unknown): ServerSettings {
  const root = asRecord(configuration);
  const compiler = asRecord(root?.compiler);
  const completion = asRecord(root?.completion);
  const diagnostics = asRecord(root?.diagnostics);
  const diagnosticCompiler = asRecord(diagnostics?.compiler);
  const configuredPath = compiler?.path;
  const enabled = diagnosticCompiler?.enabled;
  const importSorting = completion?.importSorting;
  const timeout = diagnosticCompiler?.timeoutMilliseconds;

  return {
    compilerPath:
      typeof configuredPath === "string" && configuredPath.trim() !== ""
        ? configuredPath
        : undefined,
    enabled: typeof enabled === "boolean" ? enabled : DEFAULT_SETTINGS.enabled,
    importSorting:
      importSorting === "alphabetic" || importSorting === "length" || importSorting === "none"
        ? importSorting
        : DEFAULT_SETTINGS.importSorting,
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
