import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/compiler-diagnostics.ts", "src/language-features.ts"],
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
