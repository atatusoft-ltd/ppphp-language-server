import { describe, expect, it } from "vitest";
import { compilerProcessEnvironment } from "../src/compiler-process.js";
import { compilerSettingsFromConfiguration, DEFAULT_SETTINGS } from "../src/server-settings.js";

describe("language-server host settings", () => {
  it("uses defaults when an LSP client returns no configuration object", () => {
    expect(compilerSettingsFromConfiguration(null)).toEqual(DEFAULT_SETTINGS);
    expect(compilerSettingsFromConfiguration(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(compilerSettingsFromConfiguration([])).toEqual(DEFAULT_SETTINGS);
  });

  it("accepts only valid compiler settings", () => {
    expect(
      compilerSettingsFromConfiguration({
        compiler: { path: "/tools/ppphp" },
        diagnostics: { compiler: { enabled: false, timeoutMilliseconds: 2_500 } },
      }),
    ).toEqual({
      compilerPath: "/tools/ppphp",
      enabled: false,
      timeoutMilliseconds: 2_500,
    });

    expect(
      compilerSettingsFromConfiguration({
        compiler: { path: "" },
        diagnostics: { compiler: { enabled: "no", timeoutMilliseconds: Number.NaN } },
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves the host path and adds existing desktop fallback directories", () => {
    const environment = compilerProcessEnvironment(
      { PATH: "/usr/bin:/custom/bin" },
      "darwin",
      (candidate) => candidate !== "/opt/local/bin",
    );

    expect(environment.PATH).toBe("/usr/bin:/custom/bin:/opt/homebrew/bin:/usr/local/bin");
  });
});
