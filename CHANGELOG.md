# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use the quarterly CalVer described in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Added

- Coordinated `YYYY.Q.patch[-channel]` toolchain versioning with automated cross-package consistency checks.
- Canonical ++PHP emblem branding for extension listings and `.ppphp` file icons.
- Editor-neutral Language Server Protocol foundation.
- Compiler-backed go to definition in VS Code and PhpStorm for project types, functions, local and parameter bindings, inherited members, and typed access chains, including unsaved current-document contents.
- Compiler-backed semantic tokens for PHP and ++PHP AST roles, including declarations and uses of classes, functions, methods, properties, parameters, variables, generic parameters, and extension keywords.
- Shared TextMate syntax and language configuration for `.ppphp` files.
- VS Code extension with diagnostics, completions, hover help, and document symbols.
- PhpStorm 2025.2-or-newer plugin using native JetBrains LSP and a dedicated ++PHP presentation language.
- PhpStorm `++PHP File` and `++PHP Class` actions with PHP-shaped `.ppphp` templates, Composer-aware namespace suggestions, and class, interface, trait, and enum creation.
- Reproducible local checks, pinned CI actions, dependency updates, and contribution/security policies.

### Fixed

- PhpStorm clients that advertise workspace configuration but return no `ppphp` settings no longer terminate the language server; defaults are applied and compiler-backed features remain available.
- Compiler subprocesses retain the host executable path and add existing platform-standard binary directories, allowing desktop-launched editors to find globally installed `ppphp` and PHP executables.
- `.ppphp` is the exclusive source extension across editor manifests, file watchers, language-server validation, fixtures, and documentation.
- PhpStorm uses its native PHP lexical highlighter for complete PHP-token and color-scheme parity, then layers compiler-owned language-server semantic tokens for PHP symbol roles and ++PHP extensions, without routing `.ppphp` files through PHP parser inspections.
- PHP tokenizer keywords, contextual keywords, native types, predefined constants, declarations, and references now share one compiler-backed semantic classification path instead of editor-specific word patches.
- PhpStorm automatically excludes the compiler-owned `output` and `cache` directories configured by `ppphp.json`, preventing generated PHP from producing duplicate-declaration warnings.
- PhpStorm resolves its bundled language server through the plugin descriptor, including when plugin classes have no protection-domain code source.
- PhpStorm installation and updates request the restart needed to refresh the `.ppphp` language association.
