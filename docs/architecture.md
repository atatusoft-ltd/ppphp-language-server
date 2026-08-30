# Architecture

## Design goals

The tooling has one source of language behavior, predictable failure handling, and thin editor adapters. VS Code and PhpStorm differ only where their host-native language facilities require it.

```text
       ++PHP compiler (`check` diagnostics + `editor:definition` symbols)
                                      |
                                      v
VS Code client  ---> editor-neutral LSP server <---  PhpStorm LSP provider
      |                                              |
      +---------- canonical TextMate grammar --------+
```

## Language server

`packages/language-server` communicates over standard input/output or VS Code IPC. It supports incremental document synchronization. Diagnostics invoke the compiler only for on-disk content when a document opens or saves, avoiding diagnostics for source different from the text actually checked. Definition requests use the bounded compiler editor protocol and include the current unsaved document.

Compiler processes use argument arrays rather than a shell, run with a ten-second default timeout and a ten-megabyte output limit, and accept only version 1 diagnostic or definition envelopes. Unknown envelopes fail closed and are logged without inventing editor results. Compiler byte offsets are converted explicitly to LSP UTF-16 positions, including Unicode and CRLF documents.

Editor configuration is treated as untrusted client input. Missing, null, malformed, or rejected configuration responses fall back to bounded defaults without terminating the server. Compiler subprocesses preserve the host path and add only existing platform-standard binary directories, which keeps project-local and explicitly configured compilers authoritative while supporting desktop-launched editors whose environment omits common package-manager paths.

The lexical scanner masks comments, strings, and heredocs before extracting document symbols. It is deliberately suitable for navigation outlines, not symbol identity. Go to definition instead follows compiler-owned stable symbol IDs, resolved imports, local and parameter bindings, declared receiver types, return/property chains, traits, and inheritance.

## Syntax resources

The canonical TextMate bundle lives at `res/textmate/ppphp`. It layers ++PHP constructs over the PHP TextMate grammar. A synchronization script copies it into the VS Code package, the language server consumes its canonical ++PHP matchers for semantic tokens, and CI compares the generated copies byte-for-byte.

PhpStorm registers `.ppphp` as an independent ++PHP language with a shallow delimiter parser and PSI. Its lexical highlighter delegates every PHP token to PhpStorm's native PHP highlighter, automatically preserving the host's complete PHP grammar and color scheme. The language server layers canonical ++PHP semantic tokens over that baseline. The parser lexer wraps PHP tokens only to build resilient PSI; it does not classify ++PHP constructs. The PHP parser and PHP inspections never run against `.ppphp` PSI, so future syntax does not require one-off suppression rules.

The shared editor grammar is intentionally lexical. The language server derives typed-binding candidates from its canonical matcher and supplies editor-neutral semantic tokens for ++PHP keywords and type names. Compiler diagnostics remain the authority for validity and semantics; the adapters do not invent competing rules or maintain per-keyword PHP color patches.

## Editor adapters

The VS Code extension bundles the server and uses the official `vscode-languageclient` transport. It relies on the extension host's Node runtime.

PhpStorm reads only the path fields needed for host integration from a bounded `ppphp.json` file. It automatically excludes compiler-owned output and cache directories from indexing, validates that exclusions remain inside the project and do not overlap source or stub roots, and refreshes the project index when the configuration changes.

The PhpStorm plugin targets the 2025.2 compatibility baseline, uses bundled PHP tokenization for shallow PSI and complete PHP lexical highlighting, and native LSP semantic highlighting for ++PHP constructs. It registers the `.ppphp` language and starts the bundled server with a separately installed Node.js 22 runtime.

PhpStorm source-creation actions are host-native adapters rather than language-server behavior. They reuse PhpStorm's PHP/Composer namespace provider and PHP file-header template, then create independent `.ppphp` PSI files from PHP-shaped class, interface, trait, and enum templates. Language syntax is surfaced only when the compiler marks that feature active; currently the templates emit ordinary PHP declarations.

The ++PHP code-style provider delegates option definitions, labels, previews, and defaults to PhpStorm's bundled PHP provider, then remaps PHP-specific formatter fields onto a separate ++PHP settings object. PHPDoc, code-conversion, and code-generation panels use a private settings bridge so their controls remain native without modifying the PHP scheme. Compatibility tests require the ++PHP field contract to cover PhpStorm's PHP contract. Generated class-family declarations consume the same common settings, and the canonical ++PHP default is a next-line class brace.

## Capability policy

Completion snippets, contextual documentation, and lexical semantic tokens are non-destructive and may be served locally. Compiler diagnostics and definition identities remain authoritative. Rename, references, refactoring, and formatting require explicit protocol contracts and compiler support before the server advertises them.
