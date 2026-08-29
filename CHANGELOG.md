# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use the Doria-style CalVer described in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Added

- Coordinated `YYYY.QQ.patch[-channel]` toolchain versioning with automated cross-package consistency checks.
- Canonical ++PHP emblem branding for extension listings and `.ppp` file icons.
- Editor-neutral Language Server Protocol foundation.
- Shared TextMate syntax and language configuration for `.ppp` files.
- VS Code extension with diagnostics, completions, hover help, and document symbols.
- PhpStorm 2026.2 plugin using native JetBrains LSP and TextMate integrations.
- Reproducible local checks, pinned CI actions, dependency updates, and contribution/security policies.

### Fixed

- PhpStorm resolves bundled grammar and language-server resources through its plugin descriptor, including when plugin classes have no protection-domain code source.
- PhpStorm installation and updates request the restart required by its non-dynamic TextMate bundle provider.
