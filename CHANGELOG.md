# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use the Doria-style CalVer described in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Added

- Coordinated `YYYY.Q.patch[-channel]` toolchain versioning with automated cross-package consistency checks.
- Canonical ++PHP emblem branding for extension listings and `.ppp` file icons.
- Editor-neutral Language Server Protocol foundation.
- Shared TextMate syntax and language configuration for `.ppp` files.
- VS Code extension with diagnostics, completions, hover help, and document symbols.
- PhpStorm 2026.2 plugin using native JetBrains LSP and PHP language-dialect integrations.
- Reproducible local checks, pinned CI actions, dependency updates, and contribution/security policies.

### Fixed

- Standard PHP tokens in `.ppp` files use PhpStorm's native PHP highlighting, while ++PHP contextual keywords receive an additional highlighting layer.
- PhpStorm resolves its bundled language server through the plugin descriptor, including when plugin classes have no protection-domain code source.
- PhpStorm installation and updates request the restart needed to refresh the `.ppp` language association.
