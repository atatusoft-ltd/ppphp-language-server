# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use the quarterly CalVer described in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

## [2026.3.2] - 2026-09-08

The numeric tooling version advances because `2026.3.1` has already been published to the VS Code Marketplace; compiler compatibility remains unchanged.

### Installing a release candidate

The editor packages target compiler candidate `2026.3.1-rc-2` for their editor protocol. The RC suffix identifies the compiler, not the extension or plugin release.

Compiler candidate `2026.3.1-rc-2` is published on [Packagist](https://packagist.org/packages/atatusoft/ppphp). Install this compatible candidate explicitly:

```shell
composer require --dev atatusoft/ppphp:2026.3.1-rc-2
```

This opts into this candidate only, without lowering the project's `minimum-stability`. As of September 8, 2026, no stable compiler release is published under this package name, so the unversioned stable installation command is not yet usable. Existing checkouts can restore their locked dependencies with `composer install`. See the [compiler's release notes](https://github.com/atatusoft-ltd/ppphp-src/blob/main/docs/releases/2026.3.1-rc-2.md) for its prerequisites and release-specific behavior.

Runtime verification: both packaged language servers passed clean-document and unsaved error/repair checks against the published compiler with PHP CLI `memory_limit=512M`. The same smoke project exhausted a `128M` limit while loading PHP signatures. If analysis fails at that limit, configure the PHP CLI used by the editor with `memory_limit=512M` in its `php.ini`, then restart the language server. Changing a web-server PHP configuration alone does not configure the editor's CLI process.

Projects requiring the former package must follow the [package migration steps](docs/compiler-installation.md#migrating-from-the-former-package-name) first, using the candidate command above in place of the stable command. RC-1 remains published under `atatusoft-ltd/ppphp-src`; its historical installation commands, tags, and assets are unchanged. The compiler's GitHub repository also remains unchanged.

### Fixed

- Editor setup now points directly to the published compatible compiler installation instructions. Removed obsolete package-publication blockers while keeping stable and candidate installation distinct.
- Current compiler installation and update instructions use the canonical Composer package `atatusoft/ppphp`, with migration and publication prerequisites documented. Compiler discovery continues to use the package-independent `vendor/bin/ppphp` proxy.
- Release validation requires dated notes for the current version in both the repository and packaged VS Code changelogs.

## [2026.3.1] - 2026-09-08

### Added

- Coordinated numeric tooling releases with separately validated compiler compatibility metadata.
- Canonical ++PHP emblem branding for extension listings and `.ppphp` file icons.
- Editor-neutral Language Server Protocol foundation.
- Compiler-backed go to definition in VS Code and PhpStorm for project types, functions, local and parameter bindings, inherited members, and typed access chains, including unsaved current-document contents.
- Compiler-backed semantic tokens for PHP and ++PHP AST roles, including declarations and uses of classes, functions, methods, properties, parameters, variables, generic parameters, and extension keywords.
- Compiler-verified class, interface, trait, and enum rename refactoring in VS Code and PhpStorm, including project-wide references, collision refusal, unsaved buffers, and matching `.ppphp` file renames.
- Shared TextMate syntax and language configuration for `.ppphp` files.
- VS Code extension with diagnostics, completions, hover help, and document symbols.
- PhpStorm 2025.2-or-newer plugin using native JetBrains LSP and a dedicated ++PHP presentation language.
- PhpStorm `++PHP File` and `++PHP Class` actions with PHP-shaped `.ppphp` templates, Composer-aware namespace suggestions, and class, interface, trait, and enum creation.
- Deterministic class and interface completion from ++PHP project sources, Composer dependencies, and PHP runtime types in both editors and PhpStorm's class-creation parent controls.
- Shared `Use import` actions for fully qualified types in VS Code and PhpStorm.
- Token-safe PhpStorm formatting and live indentation driven by the independent ++PHP code-style scheme.
- Reproducible local checks, pinned CI actions, dependency updates, and contribution/security policies.

### Fixed

- Extension, plugin and language-server release versions no longer inherit compiler RC suffixes. Compiler compatibility retains its exact identity separately. The VS Code publisher ID now matches the registered Marketplace publisher.

- Live diagnostics reuse the compiler's retained worker when available, coalesce superseded snapshots without cold-restarting healthy workers, and retain single-shot compatibility with older compilers. Installation changes, resource limits and shutdown retire workers safely. Unavailable analysis preserves existing diagnostics rather than falsely clearing errors; measured latency and remaining cold-start costs are documented in `docs/diagnostic-performance.md`.

- Live diagnostics use a shorter debounce, prioritize the edited document, and cancel obsolete compiler checks without publishing stale results. Other open buffers remain part of analysis; compiler semantic-analysis time still determines the remaining latency.

- Qualified type references without a leading namespace separator now offer **Use import** after compiler symbol resolution, including generic parent types and namespace aliases. Both editors retain the existing sorted-import and collision checks.

- Project-wide compiler failures appear as project notifications, preserving the reason and help instead of incorrectly underlining the first token of every open source file.

- Import intentions use native PhpStorm LSP collection rather than timeout-based polling. Unresolved short names offer namespace choices and a prefilled Create class dialog; VS Code receives the same individual import candidates. Catalog discovery includes configured PHP stubs and mixed-project PHP sources.
- Type-context scanning avoids exponential regular-expression backtracking on long declaration headers, preventing completion and import actions from stalling on ordinary source files.
- PhpStorm recognizes PHPDoc as comments and uses native Enter handling to create/continue correctly indented comment blocks without swallowing subsequent code.
- Shared live diagnostics now send unsaved buffers and open-document overlays to `editor:diagnostics`, debounce typing, and discard stale results. Compiler-core coverage is explicitly distinguished from supplemental saved-project PHPStan checks.
- PhpStorm formatting now uses PHP's distinct settings for `declare`, array/closure arrows, member access, and array-initializer parentheses. Return/assignment continuations and closures nested inside calls receive the appropriate indentation; single-quoted strings remain opaque during formatting.
- PhpStorm's ++PHP code-style adapter now preserves PHP's option labels and grouping, including function/closure terminology and array-initializer parentheses.
- Compiler diagnostics now lead with their specific message so editor problem lists do not hide it behind a generic category.
- Type completion now reuses existing imports and aliases, adds a safe import for an unambiguous external type, and retains a fully qualified reference when a short name would collide.
- Completion-generated imports now follow PhpStorm's ++PHP import-sorting setting and the equivalent VS Code setting.
- PhpStorm Reformat Code and Enter indentation now honor ++PHP indentation, spacing, brace, and blank-line settings while preserving strings and ++PHP-only syntax.
- Unmodified variable semantic tokens no longer override precise host PHP scopes, preserving native highlighting for `$this` and PHP superglobals in VS Code and PhpStorm.
- Fixed a PhpStorm startup and indexing failure when ++PHP projects are accessed through WSL or another non-default filesystem provider.
- Language-server and editor builds now verify workspace links, detect missing or wrong-platform npm dependencies, and restore the complete locked tree automatically with bounded subprocess execution, including on native Windows and WSL.
- The PhpStorm class-creation Name editor now uses the same Up/Down template cycling and shortcut hint as the native PHP dialog.
- PhpStorm clients that advertise workspace configuration but return no `ppphp` settings no longer terminate the language server; defaults are applied and compiler-backed features remain available.
- Compiler subprocesses retain the host executable path and add existing platform-standard binary directories, allowing desktop-launched editors to find globally installed `ppphp` and PHP executables.
- `.ppphp` is the exclusive source extension across editor manifests, file watchers, language-server validation, fixtures, and documentation.
- PhpStorm uses its native PHP lexical highlighter for complete PHP-token and color-scheme parity, then layers compiler-owned language-server semantic tokens for PHP symbol roles and ++PHP extensions, without routing `.ppphp` files through PHP parser inspections.
- PHP tokenizer keywords, contextual keywords, native types, predefined constants, declarations, and references now share one compiler-backed semantic classification path instead of editor-specific word patches.
- PhpStorm excludes the compiler cache, metadata, stale output, and copied PHP build artifacts while retaining compiled ++PHP declarations for native indexing.
- Mixed PhpStorm projects now resolve ++PHP-authored declarations from ordinary PHP code through compiler-manifest-filtered generated PHP, without indexing copied PHP outputs or requiring hand-written shadow stubs.
- PhpStorm resolves its bundled language server through the plugin descriptor, including when plugin classes have no protection-domain code source.
- PhpStorm installation and updates request the restart needed to refresh the `.ppphp` language association.
