# Roadmap

## 0.1 foundation

- `.ppphp` syntax coverage through VS Code TextMate grammar and PhpStorm's dedicated ++PHP presentation language
- Compiler-backed diagnostics on open/save
- ++PHP snippets and contextual hover help
- Lexical document outline
- Compiler-backed go to definition for project symbols, bindings, members, inheritance, and typed chains
- PhpStorm actions for creating `.ppphp` files, classes, interfaces, traits, and enums
- Reproducible editor packages and CI

## Next: compiler/editor protocol

- Extend the bounded, versioned compiler editor protocol beyond its definition request
- Expose syntax tokens and precise AST node categories
- Expose complete reference sets, scopes, and richer type information using the existing stable symbol IDs
- Add cancellation and incremental project-index updates
- Define capability/version negotiation between the server and compiler

## Semantic features

Once the compiler protocol exists:

- Find references
- Semantic tokens layered over each editor's lexical highlighting
- Signature help and type-aware completion
- Workspace symbols
- Safe rename and focused code actions
- Checked-error and generic-type refactorings

## Later

- Canonical formatter or format-preserving edit protocol
- Integration tests against real VS Code and PhpStorm sandboxes
- Signed Marketplace and JetBrains Plugin Repository releases
- Reproducible release provenance and software bill of materials
