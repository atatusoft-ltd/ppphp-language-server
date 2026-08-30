# Architecture

## Design goals

The tooling has one source of language behavior, predictable failure handling, and thin editor adapters. VS Code and PhpStorm differ only where their host-native language facilities require it.

```text
                    ++PHP compiler (`ppphp check --format=json`)
                                      |
                                      v
VS Code client  ---> editor-neutral LSP server <---  PhpStorm LSP provider
      |                                              |
TextMate grammar                        dedicated ++PHP PSI and lexer
```

## Language server

`packages/language-server` communicates over standard input/output or VS Code IPC. It supports incremental document synchronization but invokes the compiler only for on-disk content when a document opens or saves. This avoids presenting diagnostics for source different from the text actually checked by the compiler.

Compiler processes use argument arrays rather than a shell, run with a ten-second default timeout and a ten-megabyte output limit, and accept only diagnostic envelope version 1. Unknown envelopes fail closed and are logged without inventing editor diagnostics.

The lexical scanner masks comments, strings, and heredocs before extracting document symbols. It is deliberately suitable for navigation outlines, not symbol identity or refactoring.

## Syntax resources

The canonical TextMate bundle lives at `res/textmate/ppphp`. It layers ++PHP constructs over VS Code's PHP grammar. A synchronization script copies the grammar and language configuration into the VS Code package, and CI compares the generated copies byte-for-byte.

PhpStorm registers `.ppphp` as an independent ++PHP language with its own token types, shallow presentation parser, and PSI. The presentation lexer recognizes extension syntax as a class—including typed bindings, generic types, `readonly`, `throws`, and `when`—while delegating ordinary PHP token colors to PhpStorm's native PHP highlighter. The PHP parser and PHP inspections never run against `.ppphp` PSI, so future ++PHP constructs do not require one-off suppression rules. Integration tests require ordinary PHP tokens such as `use`, `echo`, and qualified names to retain the same attributes in `.php` and `.ppphp` files.

Both editor grammars are intentionally lexical. Compiler diagnostics delivered over LSP are the authority for syntax and semantics; the adapters do not invent competing validity rules.

## Editor adapters

The VS Code extension bundles the server and uses the official `vscode-languageclient` transport. It relies on the extension host's Node runtime.

PhpStorm reads only the path fields needed for host integration from a bounded `ppphp.json` file. It automatically excludes compiler-owned output and cache directories from indexing, validates that exclusions remain inside the project and do not overlap source or stub roots, and refreshes the project index when the configuration changes.

The PhpStorm plugin targets the 2025.2 compatibility baseline, depends on its bundled PHP plugin only for lexical tokenization and familiar color attributes, registers the `.ppphp` language and native LSP integration provider, and starts the bundled server with a separately installed Node.js 22 runtime.

## Capability policy

Completion snippets and contextual documentation are non-destructive and may be served locally. Compiler diagnostics remain authoritative. Rename, references, refactoring, semantic tokens, and formatting require explicit protocol contracts and compiler support before the server advertises them.
