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
      "editors/zed/grammars/**",
      "editors/zed/target/**",
      "grammars/ppphp/vendor/**",
      "grammars/ppphp/src/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["grammars/ppphp/grammar.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: Object.fromEntries(
        ["grammar", "seq", "choice", "repeat", "optional", "field", "alias", "token", "prec"].map(
          (name) => [name, "readonly"],
        ),
      ),
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
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
