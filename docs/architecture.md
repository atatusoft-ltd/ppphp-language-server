# Architecture

## Design goals

The tooling has one source of language behavior, predictable failure handling, and thin editor adapters. VS Code and PhpStorm should differ only in process startup, packaging, and host integration.

```text
                    ++PHP compiler (`ppphp check --format=json`)
                                      |
                                      v
VS Code client  ---> editor-neutral LSP server <---  PhpStorm LSP provider
      |                         |
      +---------- shared TextMate bundle -----------+
```

## Language server

`packages/language-server` communicates over standard input/output or VS Code IPC. It supports incremental document synchronization but invokes the compiler only for on-disk content when a document opens or saves. This avoids presenting diagnostics for source different from the text actually checked by the compiler.

Compiler processes use argument arrays rather than a shell, run with a ten-second default timeout and a ten-megabyte output limit, and accept only diagnostic envelope version 1. Unknown envelopes fail closed and are logged without inventing editor diagnostics.

The lexical scanner masks comments, strings, and heredocs before extracting document symbols. It is deliberately suitable for navigation outlines, not symbol identity or refactoring.

## Shared syntax resources

The canonical TextMate bundle lives at `res/textmate/ppphp`. It layers ++PHP constructs over the host's PHP grammar. A synchronization script copies the grammar and language configuration into the VS Code package. The PhpStorm build packages the canonical bundle directly. CI compares generated copies byte-for-byte.

TextMate scopes provide immediate syntax highlighting. Semantic tokens can augment them later when the compiler exposes stable token and symbol classifications.

## Editor adapters

The VS Code extension bundles the server and uses the official `vscode-languageclient` transport. It relies on the extension host's Node runtime.

The PhpStorm plugin targets 2026.2, registers JetBrains' native LSP integration provider, and registers the shared bundle through the TextMate plugin. It starts the bundled server with a separately installed Node.js 22 runtime.

## Capability policy

Completion snippets and contextual documentation are non-destructive and may be served locally. Compiler diagnostics remain authoritative. Rename, references, refactoring, semantic tokens, and formatting require explicit protocol contracts and compiler support before the server advertises them.
