# ++PHP Language Server

Editor tooling for ++PHP source files. This repository contains one editor-neutral Language Server Protocol (LSP) implementation plus thin integrations for Visual Studio Code and PhpStorm.

## Current capabilities

| Capability                 | VS Code | PhpStorm | Notes                                           |
| -------------------------- | ------- | -------- | ----------------------------------------------- |
| `.ppphp` file recognition  | Yes     | Yes      | Exclusive extension and shared emblem icon      |
| Syntax highlighting        | Yes     | Yes      | Native PHP baseline plus shared semantic tokens |
| Compiler diagnostics       | Yes     | Yes      | Runs `ppphp check` on open and save             |
| ++PHP completions/snippets | Yes     | Yes      | Typed locals, generics, `throws`, and `when`    |
| Keyword hover help         | Yes     | Yes      | Documents ++PHP extensions                      |
| Document symbols           | Yes     | Yes      | Safe lexical outline                            |
| File/declaration creation  | Native  | Yes      | PhpStorm `++PHP File` and `++PHP Class` actions |
| Rename/refactoring         | Not yet | Not yet  | Requires a compiler-backed semantic index       |
| Formatting                 | Not yet | Not yet  | Requires an agreed canonical formatter          |

The server intentionally does not advertise semantic refactors until it can prove symbol identity across scopes and files. This keeps editor actions predictable and avoids destructive textual renames.

## Requirements

- PHP 8.4 or newer for repository tooling and build orchestration
- Node.js 22 or newer
- npm 10 or newer
- The ++PHP compiler, either:
  - at `vendor/bin/ppphp` in the opened project,
  - available as `ppphp` on `PATH`, or
  - configured explicitly in the editor or through `PPPHP_COMPILER_PATH`
- For the PhpStorm plugin build: Java 21 or newer; the checked-in Gradle wrapper supplies Gradle itself

## Local development

Repository automation is deliberately written in PHP. TypeScript is confined to the Node-based language server and VS Code client, while Kotlin is confined to the JetBrains plugin.

```shell
npm ci
npm run check
php scripts/build.php help
```

Build either editor package, or both:

```shell
php scripts/build.php vscode
php scripts/build.php phpstorm
php scripts/build.php editors
```

The VS Code package is written to `build/ppphp-vscode.vsix`. The PhpStorm plugin archive is written below `editors/phpstorm/build/distributions/`.

## Versioning

Language-server and editor releases track the ++PHP toolchain using quarterly CalVer. The current version is `2026.3.1` across every package and editor manifest.

See [docs/releasing.md](docs/releasing.md) for the version policy and coordinated release checklist.

## Configuration

VS Code exposes these workspace/resource settings:

- `ppphp.compiler.path`
- `ppphp.diagnostics.compiler.enabled`
- `ppphp.diagnostics.compiler.timeoutMilliseconds`

For clients without settings support, set `PPPHP_COMPILER_PATH`. The PhpStorm host also needs Node.js available on `PATH`, through `PPPHP_NODE_PATH`, or through the JVM option `-Dppphp.language.server.node.path=/absolute/path/to/node`.

## Repository layout

```text
packages/language-server/  Editor-neutral TypeScript LSP server
res/textmate/ppphp/        Canonical shared language and grammar resources
res/images/                Canonical ++PHP emblem and packaged raster asset
editors/vscode/            Visual Studio Code client and packaged resources
editors/phpstorm/          JetBrains LSP, TextMate, and ++PHP PSI integration
docs/                      Architecture and roadmap decisions
scripts/                   PHP build orchestration and repository guardrails
```

Edit grammar and language configuration files only under `res/textmate/ppphp/`, then run `php scripts/sync_language_resources.php`. The `npm run sync:resources` alias remains available for npm workflows. CI rejects stale generated VS Code copies.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Please report security issues according to [SECURITY.md](SECURITY.md), not in a public issue.

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).
