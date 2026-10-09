# Roadmap

## Implemented in source

- `.ppphp` syntax coverage through VS Code TextMate grammar and PhpStorm's dedicated ++PHP presentation language
- Debounced compiler-core diagnostics for unsaved edits, retained compiler workers, cancellation and stale-result rejection; saved-project supplemental analysis remains a compiler command
- ++PHP snippets and contextual hover help
- Lexical document outline
- Compiler-backed go to definition for project symbols, bindings, members, inheritance, and typed chains
- Compiler-backed semantic tokens layered over each editor's complete PHP lexical highlighting
- Deterministic type completion with sorted imports and collision-safe aliases
- Shared import actions for qualified names and unresolved type candidates
- Compiler-verified class-family rename with capability-checked workspace edits
- PhpStorm actions for creating `.ppphp` files, classes, interfaces, traits, and enums
- Reproducible editor packages and CI
- PhpStorm token-safe formatting and live indentation using the independent ++PHP code-style scheme
- PhpStorm PHPDoc Enter handling and compiler-manifest-backed indexing for mixed PHP/++PHP projects
- Standalone server bundles with stdio smoke tests, a native Tree-sitter grammar, and the Zed adapter with checked managed downloads

Source implementation is not publication. See [editor-support.md](editor-support.md) for distribution status and [releasing.md](releasing.md) for artifact, runtime and owner-publication gates.

## Next: qualification and delivery

- Qualify each rebuilt package in clean editor profiles, including upgrades, compiler failures and recovery
- Publish validated updates through the existing VS Code and JetBrains listings with maintainer approval
- Publish the standalone server asset, exercise Zed's real download/upgrade path, and submit the Zed registry entry
- Complete Windows/WSL and remote-host smoke coverage without inferring interactive compatibility from CI or binary verification

## Further compiler/editor protocol work

- Expose complete reference sets, scopes, and richer type information using the existing stable symbol IDs
- Extend cancellation beyond the existing diagnostic scheduler and add incremental project-index updates
- Extend capability negotiation beyond the current versioned envelopes and retained-diagnostic-worker handshake

## Semantic features

These are not advertised by the current server and require explicit compiler contracts:

- Find references
- Signature help and richer expression/member completion beyond the existing type catalog
- Workspace symbols
- Rename beyond class-family declarations and additional semantic code actions
- Checked-error and generic-type refactorings

## Later

- Xdebug-backed debugging: the [executed feasibility spike](debugger-spike.md) establishes runtime/editor reuse and identifies the remaining setup and source-stepping work; this is not a shipped debugger.
- Editor-neutral canonical formatter or format-preserving edit protocol for VS Code parity
- Broader real-editor integration coverage beyond the existing PhpStorm SDK tests and stdio tests
- Reproducible release provenance and software bill of materials
- A standalone installable `ppphp-ls` command and the planned Neovim, Sublime Text and Helix adapters; build on the existing server, grammar and Zed work tracked in [editor-support.md](editor-support.md)
