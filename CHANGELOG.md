# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use the quarterly CalVer described in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Added

- Coordinated `YYYY.Q.patch[-channel]` toolchain versioning with automated cross-package consistency checks.
- Canonical ++PHP emblem branding for extension listings and `.ppphp` file icons.
- Editor-neutral Language Server Protocol foundation.
- Shared TextMate syntax and language configuration for `.ppphp` files.
- VS Code extension with diagnostics, completions, hover help, and document symbols.
- PhpStorm 2025.2-or-newer plugin using native JetBrains LSP and a dedicated ++PHP presentation language.
- PhpStorm `++PHP File` and `++PHP Class` actions with PHP-shaped `.ppphp` templates, Composer-aware namespace suggestions, and class, interface, trait, and enum creation.
- Reproducible local checks, pinned CI actions, dependency updates, and contribution/security policies.

### Fixed

- `.ppphp` is the exclusive source extension across editor manifests, file watchers, language-server validation, fixtures, and documentation.
- PhpStorm consumes the canonical TextMate bundle for lexical highlighting and shared language-server semantic tokens for typed bindings, generic types, `readonly`, `throws`, and `when`, without routing `.ppphp` files through PHP parser inspections.
- PhpStorm automatically excludes the compiler-owned `output` and `cache` directories configured by `ppphp.json`, preventing generated PHP from producing duplicate-declaration warnings.
- PhpStorm resolves its bundled language server through the plugin descriptor, including when plugin classes have no protection-domain code source.
- PhpStorm installation and updates request the restart needed to refresh the `.ppphp` language association.
- PhpStorm stores dynamic TextMate scopes through its scope-aware editor highlighter, preserving syntax colors without unregistered-token failures.
