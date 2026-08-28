import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.gradle/**",
      "**/.intellijPlatform/**",
      "**/.vite/**",
      "**/build/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "editors/vscode/language-configuration.json",
      "editors/vscode/syntaxes/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
