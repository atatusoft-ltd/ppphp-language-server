import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "src/composer-namespace.ts",
        "src/compiler-definition.ts",
        "src/compiler-diagnostics.ts",
        "src/compiler-process.ts",
        "src/compiler-semantic-tokens.ts",
        "src/language-features.ts",
        "src/semantic-tokens.ts",
        "src/server-settings.ts",
      ],
      provider: "v8",
      reporter: ["text"],
      thresholds: {
        branches: 40,
        functions: 60,
        lines: 60,
        statements: 60,
      },
    },
  },
});
