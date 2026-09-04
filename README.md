# ++PHP Language Server

Editor tooling for ++PHP source files. This repository contains one editor-neutral Language Server Protocol (LSP) implementation plus thin integrations for Visual Studio Code and PhpStorm.

## Current capabilities

| Capability                | VS Code | PhpStorm | Notes                                               |
| ------------------------- | ------- | -------- | --------------------------------------------------- |
| `.ppphp` file recognition | Yes     | Yes      | Exclusive extension and shared emblem icon          |
| Syntax highlighting       | Yes     | Yes      | PHP lexical baseline plus compiler semantic roles   |
| Compiler diagnostics      | Yes     | Yes      | Runs `ppphp check` on open and save                 |
| Deterministic completions | Yes     | Yes      | Known project, Composer, PHP, and ++PHP constructs  |
| Keyword hover help        | Yes     | Yes      | Documents ++PHP extensions                          |
| Document symbols          | Yes     | Yes      | Safe lexical outline                                |
| Go to definition          | Yes     | Yes      | Compiler-owned project symbols and member types     |
| File/declaration creation | Native  | Yes      | PhpStorm `++PHP File` and `++PHP Class` actions     |
| Code-style settings       | No      | Yes      | PHP formatter controls with ++PHP-owned values      |
| Class-family rename       | Yes     | Yes      | Compiler-verified project edits and file rename     |
| Use import                | Yes     | Yes      | Safe type imports from the shared symbol catalog    |
| Formatting                | Not yet | Yes      | Token-safe PhpStorm formatting and live indentation |

Go to definition uses compiler-owned symbol identity across scopes and files. Rename uses the same identity to verify every candidate class, interface, trait, or enum reference before returning project-wide edits. Comments, strings, unrelated same-spelling symbols, generated output, cache directories, and non-`.ppphp` files are not edited. A matching source filename is renamed with its declaration, and collisions or incomplete editor support are refused instead of producing a partial refactor. Function, method, property, variable, and parameter rename remain unavailable until their dynamic and scope-specific safety contracts are complete.

Syntax highlighting follows the same ownership boundary in both editors: each host supplies its PHP lexical baseline, while the compiler fills every parser-dependent PHP role and adds ++PHP semantics. Compiler roles cover PHP tokenizer keywords, native types and constants, classes, functions, methods, properties, parameters, variables, generic parameters, and ++PHP keywords. The language server converts the compiler's UTF-8 ranges into standard LSP semantic tokens. A small grammar-derived ++PHP fallback remains available when the compiler cannot parse the current buffer.

Completion is deterministic rather than generative. The language server catalogs class-family declarations from configured ++PHP source roots, Composer autoload roots, installed Composer packages, and the active PHP runtime. It narrows `extends` to inheritable classes and `implements` or interface inheritance to interfaces. Completion reuses an existing import or alias, inserts a safe sorted `use` statement when the short name is available, and retains a fully qualified reference when importing would collide. A fully qualified type also offers a shared `Use import` action. PhpStorm uses the same catalog in its class-creation parent controls and supplements it with PhpStorm's PHP project index.

In mixed PhpStorm projects, native PHP code can resolve declarations authored in `.ppphp` after a successful `ppphp build`. The plugin reads the compiler's output manifest and exposes only PHP files compiled from ++PHP as a filtered synthetic library. Compiler cache data, metadata, stale output, and ordinary PHP files copied into the output remain excluded, so native indexing gains the generated declarations without duplicate PHP symbols. Hand-written shadow stubs are neither required nor recommended for this purpose.

## Requirements

- PHP 8.4 or newer for repository tooling and build orchestration
- Node.js 22 or newer
- npm 10 or newer
- The ++PHP compiler, either:
  - at `vendor/bin/ppphp` in the opened project,
  - available as `ppphp` on `PATH` or in a platform-standard binary directory, or
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

The PHP build entrypoint validates the complete root npm workspace before invoking
Node.js tooling. If packages are missing, stale, or unusable after moving the
checkout between Windows and WSL, it automatically restores the exact
`package-lock.json` dependency tree with `npm ci`. Running `npm ci` explicitly is
still recommended before the complete development check above.

The VS Code package is written to `build/ppphp-vscode.vsix`. The PhpStorm plugin archive is written below `editors/phpstorm/build/distributions/`.

## Versioning

Language-server and editor releases track the ++PHP toolchain using quarterly CalVer. The current version is `2026.3.1-rc-2` across every package and editor manifest.

See [docs/releasing.md](docs/releasing.md) for the version policy and coordinated release checklist.

## Configuration

VS Code exposes these workspace/resource settings:

- `ppphp.compiler.path`
- `ppphp.completion.importSorting`
- `ppphp.diagnostics.compiler.enabled`
- `ppphp.diagnostics.compiler.timeoutMilliseconds`

Clients that return no ++PHP configuration use safe defaults. For an explicit compiler override, set `PPPHP_COMPILER_PATH`. The PhpStorm host also needs Node.js available on `PATH`, through `PPPHP_NODE_PATH`, or through the JVM option `-Dppphp.language.server.node.path=/absolute/path/to/node`.

Both editor integrations use the host's standard definition action. Cmd+Click works on macOS, Ctrl+Click on Windows and Linux, and the editors' keyboard/menu **Go to Definition** commands remain available. Resolution covers imports, project classes and functions, typed locals and parameters, inherited methods and properties, and typed call/property chains.

Class-family declarations and references use each editor's standard rename action: **Rename Symbol** in VS Code and **Refactor | Rename** in PhpStorm. Project-wide rename requires `ppphp.json` at the workspace root so the language server can honor its source, output, cache, and exclusion boundaries.

## PhpStorm code style

PhpStorm exposes ++PHP under **Editor | Code Style | ++PHP**. Its formatter controls and defaults are sourced from PhpStorm's PHP support, while each scheme stores independent ++PHP values. Reformat Code and live Enter indentation honor the configured indentation, spacing, brace-placement, and blank-line settings without parsing `.ppphp` as ordinary PHP, so generics, typed locals, checked errors, and `when` expressions remain intact. New class, interface, trait, and enum files use the same class-brace settings; the ++PHP default places declaration braces on the next line. Type completion also reads the ++PHP import-sorting choice from the code-conversion settings.

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
