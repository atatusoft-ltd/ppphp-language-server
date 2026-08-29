# Repository guidance

## Architecture

- Keep the LSP implementation editor-neutral under `packages/language-server`.
- Keep VS Code and PhpStorm code thin; do not duplicate language analysis in an editor adapter.
- Use PHP for repository automation and build orchestration. Use platform languages only where the target integration requires them.
- Treat `res/textmate/ppphp` as the canonical language-resource source. Run `npm run sync:resources` after changing it.
- Treat the compiler's versioned JSON diagnostic envelope as an external contract. Reject unknown versions rather than guessing.
- Do not advertise rename, code actions, or formatting until tests demonstrate that the operation is semantic and safe.

## Verification

- Run `php scripts/check_repository_tooling.php` and `php scripts/check_release_version.php` for repository guardrails.
- Run `npm run check` for TypeScript, grammar, and VS Code changes.
- Use `php scripts/build.php vscode`, `php scripts/build.php phpstorm`, or `php scripts/build.php editors` for installable editor artifacts.
- Run `./editors/phpstorm/gradlew -p editors/phpstorm check buildPlugin verifyPluginStructure verifyPluginProjectConfiguration verifyPlugin` for JetBrains changes.
- Add focused tests for parsing, position conversion, and any new LSP capability.
- Never commit generated `dist`, `build`, `.vsix`, or IDE sandbox files.

## Engineering practices

- Preserve protocol compatibility and capability honesty over feature count.
- Keep subprocess execution argument-based; never construct compiler shell commands from document or workspace input.
- Bound subprocess time and output size.
- Avoid logging source text, environment variables, or full compiler configuration.
- Pin GitHub Actions to immutable commit SHAs and keep workflow permissions read-only unless a job has a documented need.
