# Roadmap

## 0.1 foundation

- Shared `.phplus` TextMate syntax for VS Code and PhpStorm
- Compiler-backed diagnostics on open/save
- ++PHP snippets and contextual hover help
- Lexical document outline
- Reproducible editor packages and CI

## Next: compiler/editor protocol

- Add a compiler command that accepts unsaved source through a bounded, versioned protocol
- Expose syntax tokens and precise AST node categories
- Expose stable symbol IDs, definitions, references, scopes, and type information
- Add cancellation and incremental project-index updates
- Define capability/version negotiation between the server and compiler

## Semantic features

Once the compiler protocol exists:

- Go to definition and find references
- Semantic tokens layered over TextMate highlighting
- Signature help and type-aware completion
- Workspace symbols
- Safe rename and focused code actions
- Checked-error and generic-type refactorings

## Later

- Canonical formatter or format-preserving edit protocol
- Integration tests against real VS Code and PhpStorm sandboxes
- Signed Marketplace and JetBrains Plugin Repository releases
- Reproducible release provenance and software bill of materials
