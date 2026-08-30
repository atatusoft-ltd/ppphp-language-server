# Architecture

## Design goals

The tooling has one source of language behavior, predictable failure handling, and thin editor adapters. VS Code and PhpStorm differ only where their host-native language facilities require it.

```text
                    ++PHP compiler (`ppphp check --format=json`)
                                      |
                                      v
VS Code client  ---> editor-neutral LSP server <---  PhpStorm LSP provider
      |                                              |
      +---------- canonical TextMate grammar --------+
```

## Language server

`packages/language-server` communicates over standard input/output or VS Code IPC. It supports incremental document synchronization but invokes the compiler only for on-disk content when a document opens or saves. This avoids presenting diagnostics for source different from the text actually checked by the compiler.

Compiler processes use argument arrays rather than a shell, run with a ten-second default timeout and a ten-megabyte output limit, and accept only diagnostic envelope version 1. Unknown envelopes fail closed and are logged without inventing editor diagnostics.

The lexical scanner masks comments, strings, and heredocs before extracting document symbols. It is deliberately suitable for navigation outlines, not symbol identity or refactoring.

## Syntax resources

The canonical TextMate bundle lives at `res/textmate/ppphp`. It layers ++PHP constructs over the PHP TextMate grammar. The PhpStorm plugin packages this directory directly; a synchronization script copies it into the VS Code package, and CI compares the generated copies byte-for-byte.

PhpStorm registers `.ppphp` as an independent ++PHP language with a shallow delimiter parser and PSI. Its syntax highlighter delegates to JetBrains TextMate integration and the same canonical bundle used by VS Code. The parser lexer wraps PHP tokens only to build resilient PSI; it does not classify ++PHP constructs. The PHP parser and PHP inspections never run against `.ppphp` PSI, so future syntax does not require one-off suppression rules.

The shared editor grammar is intentionally lexical. The language server derives typed-binding candidates from its canonical matcher and supplies editor-neutral semantic tokens for ++PHP keywords and type names. Compiler diagnostics remain the authority for validity and semantics; the adapters do not invent competing rules.

## Editor adapters

The VS Code extension bundles the server and uses the official `vscode-languageclient` transport. It relies on the extension host's Node runtime.

PhpStorm reads only the path fields needed for host integration from a bounded `ppphp.json` file. It automatically excludes compiler-owned output and cache directories from indexing, validates that exclusions remain inside the project and do not overlap source or stub roots, and refreshes the project index when the configuration changes.

The PhpStorm plugin targets the 2025.2 compatibility baseline, uses bundled PHP tokenization for shallow PSI, bundled TextMate support for lexical highlighting, and native LSP semantic highlighting for ++PHP constructs. It registers the `.ppphp` language and starts the bundled server with a separately installed Node.js 22 runtime.

PhpStorm source-creation actions are host-native adapters rather than language-server behavior. They reuse PhpStorm's PHP/Composer namespace provider and PHP file-header template, then create independent `.ppphp` PSI files from PHP-shaped class, interface, trait, and enum templates. Language syntax is surfaced only when the compiler marks that feature active; currently the templates emit ordinary PHP declarations.

## Capability policy

Completion snippets, contextual documentation, and lexical semantic tokens are non-destructive and may be served locally. Compiler diagnostics remain authoritative. Rename, references, refactoring, and formatting require explicit protocol contracts and compiler support before the server advertises them.
