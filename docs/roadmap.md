# Roadmap

## 0.1 foundation

- `.ppphp` syntax coverage through VS Code TextMate grammar and PhpStorm's dedicated ++PHP presentation language
- Compiler-backed diagnostics on open/save
- ++PHP snippets and contextual hover help
- Lexical document outline
- Compiler-backed go to definition for project symbols, bindings, members, inheritance, and typed chains
- Compiler-backed semantic tokens layered over each editor's complete PHP lexical highlighting
- PhpStorm actions for creating `.ppphp` files, classes, interfaces, traits, and enums
- Reproducible editor packages and CI
- PhpStorm token-safe formatting and live indentation using the independent ++PHP code-style scheme

## Next: compiler/editor protocol

- Expose complete reference sets, scopes, and richer type information using the existing stable symbol IDs
- Add cancellation and incremental project-index updates
- Define capability/version negotiation between the server and compiler

## Semantic features

Once the compiler protocol exists:

- Find references
- Signature help and type-aware completion
- Workspace symbols
- Safe rename and focused code actions
- Checked-error and generic-type refactorings

## Later

- Editor-neutral canonical formatter or format-preserving edit protocol for VS Code parity
- Integration tests against real VS Code and PhpStorm sandboxes
- Signed Marketplace and JetBrains Plugin Repository releases
- Reproducible release provenance and software bill of materials
- Standalone `ppphp-ls` distribution, a Tree-sitter grammar, and the Neovim, Sublime Text, and Zed integrations tracked in [editor-support.md](editor-support.md)
