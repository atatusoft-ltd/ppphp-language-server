# ++PHP Language Server

Editor tooling for ++PHP source files. This repository contains one editor-neutral Language Server Protocol (LSP) implementation plus thin integrations for Visual Studio Code and PhpStorm.

## Current capabilities

| Capability                 | VS Code | PhpStorm | Notes                                        |
| -------------------------- | ------- | -------- | -------------------------------------------- |
| `.ppp` file recognition    | Yes     | Yes      | Shared language definition and emblem icon   |
| Syntax highlighting        | Yes     | Yes      | Shared TextMate grammar layered over PHP     |
| Compiler diagnostics       | Yes     | Yes      | Runs `ppphp check` on open and save          |
| ++PHP completions/snippets | Yes     | Yes      | Typed locals, generics, `throws`, and `when` |
| Keyword hover help         | Yes     | Yes      | Documents ++PHP extensions                   |
| Document symbols           | Yes     | Yes      | Safe lexical outline                         |
| Rename/refactoring         | Not yet | Not yet  | Requires a compiler-backed semantic index    |
| Formatting                 | Not yet | Not yet  | Requires an agreed canonical formatter       |

The server intentionally does not advertise semantic refactors until it can prove symbol identity across scopes and files. This keeps editor actions predictable and avoids destructive textual renames.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- The ++PHP compiler, either:
  - at `vendor/bin/ppphp` in the opened project,
  - available as `ppphp` on `PATH`, or
  - configured explicitly in the editor or through `PPPHP_COMPILER_PATH`
- For the PhpStorm plugin build: Java 25; the checked-in Gradle wrapper supplies Gradle itself

## Local development

```shell
npm ci
npm run check
```

Build editor packages:

```shell
npm run package:vscode
./editors/phpstorm/gradlew -p editors/phpstorm buildPlugin
```

The VS Code package is written to `build/ppphp-vscode.vsix`. The PhpStorm plugin archive is written below `editors/phpstorm/build/distributions/`.

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
editors/phpstorm/          JetBrains LSP/TextMate integration
docs/                      Architecture and roadmap decisions
scripts/                   Reproducible repository tooling
```

Edit grammar and language configuration files only under `res/textmate/ppphp/`, then run `npm run sync:resources`. CI rejects stale generated VS Code copies.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Please report security issues according to [SECURITY.md](SECURITY.md), not in a public issue.

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).
