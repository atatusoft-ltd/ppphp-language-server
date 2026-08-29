# Architecture

## Design goals

The tooling has one source of language behavior, predictable failure handling, and thin editor adapters. VS Code and PhpStorm differ only where their host-native language facilities require it.

```text
                    ++PHP compiler (`ppphp check --format=json`)
                                      |
                                      v
VS Code client  ---> editor-neutral LSP server <---  PhpStorm LSP provider
      |                                              |
TextMate grammar                           native PHP language dialect
```

## Language server

`packages/language-server` communicates over standard input/output or VS Code IPC. It supports incremental document synchronization but invokes the compiler only for on-disk content when a document opens or saves. This avoids presenting diagnostics for source different from the text actually checked by the compiler.

Compiler processes use argument arrays rather than a shell, run with a ten-second default timeout and a ten-megabyte output limit, and accept only diagnostic envelope version 1. Unknown envelopes fail closed and are logged without inventing editor diagnostics.

The lexical scanner masks comments, strings, and heredocs before extracting document symbols. It is deliberately suitable for navigation outlines, not symbol identity or refactoring.

## Syntax resources

The canonical TextMate bundle lives at `res/textmate/ppphp`. It layers ++PHP constructs over VS Code's PHP grammar. A synchronization script copies the grammar and language configuration into the VS Code package, and CI compares the generated copies byte-for-byte.

PhpStorm registers ++PHP as a dialect of its bundled PHP language. Its syntax highlighter delegates standard tokens to the native PHP highlighter and adds ++PHP contextual keywords. Integration tests require ordinary PHP tokens such as `use`, `echo`, and qualified names to retain the same native attributes in `.php` and `.ppp` files. PHP parser errors are hidden for `.ppp` files because the ++PHP compiler diagnostics delivered over LSP are authoritative.

## Editor adapters

The VS Code extension bundles the server and uses the official `vscode-languageclient` transport. It relies on the extension host's Node runtime.

PhpStorm reads only the path fields needed for host integration from a bounded `ppphp.json` file. It automatically excludes compiler-owned output and cache directories from indexing, validates that exclusions remain inside the project and do not overlap source or stub roots, and refreshes the project index when the configuration changes.

The PhpStorm plugin targets 2026.2, depends on its bundled PHP plugin, registers the `.ppp` dialect and native LSP integration provider, and starts the bundled server with a separately installed Node.js 22 runtime.

## Capability policy

Completion snippets and contextual documentation are non-destructive and may be served locally. Compiler diagnostics remain authoritative. Rename, references, refactoring, semantic tokens, and formatting require explicit protocol contracts and compiler support before the server advertises them.
