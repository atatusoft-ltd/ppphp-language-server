# Architecture

## Design goals

The tooling has one source of language behavior, predictable failure handling, and thin editor adapters. VS Code and PhpStorm differ only where their host-native language facilities require it.

```text
 ++PHP compiler (diagnostics + definitions + semantic symbol roles)
                                      |
                                      v
VS Code client  ---> editor-neutral LSP server <---  PhpStorm LSP provider
      |                                              |
      +---------- canonical TextMate grammar --------+
```

## Language server

`packages/language-server` communicates over standard input/output or VS Code IPC. It supports incremental document synchronization. Diagnostics invoke the compiler only for on-disk content when a document opens or saves, avoiding diagnostics for source different from the text actually checked. Definition and semantic-token requests use bounded compiler editor protocols and include the current unsaved document.

Compiler processes use argument arrays rather than a shell, run with a ten-second default timeout and a ten-megabyte output limit, and accept only version 1 diagnostic, definition, or semantic-token envelopes. Unknown envelopes fail closed and are logged without inventing editor results. Compiler byte offsets are converted explicitly to LSP UTF-16 positions, including Unicode and CRLF documents.

Editor configuration is treated as untrusted client input. Missing, null, malformed, or rejected configuration responses fall back to bounded defaults without terminating the server. Compiler subprocesses preserve the host path and add only existing platform-standard binary directories, which keeps project-local and explicitly configured compilers authoritative while supporting desktop-launched editors whose environment omits common package-manager paths.

The lexical scanner masks comments, strings, and heredocs before extracting document symbols. It is deliberately suitable for navigation outlines, not symbol identity. Go to definition instead follows compiler-owned stable symbol IDs, resolved imports, local and parameter bindings, declared receiver types, return/property chains, traits, and inheritance.

## Syntax resources

The canonical TextMate bundle lives at `res/textmate/ppphp`. It layers ++PHP constructs over the PHP TextMate grammar. A synchronization script copies it into the VS Code package, the language server consumes its canonical ++PHP matchers only as a semantic-token fallback, and CI compares the generated copies byte-for-byte.

PhpStorm registers `.ppphp` as an independent ++PHP language with a shallow delimiter parser and PSI. Its lexical highlighter delegates every PHP lexer token to PhpStorm's native PHP highlighter, preserving the host's PHP color scheme. PhpStorm normally assigns some contextual PHP colors during its PHP parser pass; because that parser must not consume ++PHP syntax, compiler semantic tokens supply those parser-dependent PHP roles together with ++PHP roles. The parser lexer wraps PHP tokens only to build resilient PSI; it does not classify ++PHP constructs. PHP inspections never run against `.ppphp` PSI, so future syntax does not require one-off suppression rules.

The shared editor grammar is intentionally lexical. The compiler parses the unsaved document and supplies editor-neutral semantic roles for PHP and ++PHP: every keyword reported by PHP's tokenizer, context-derived native types and predefined constants, declarations and uses of classes, functions, methods, properties, parameters, variables, generic parameters, and extension keywords. The standard `defaultLibrary` modifier distinguishes native PHP types and constants from project symbols. If the compiler is unavailable or cannot produce an AST, the language server falls back to the canonical grammar for ++PHP-only keywords and non-native type names. Editor adapters map roles to host-native color keys; they do not maintain per-keyword PHP patches.

## Editor adapters

The VS Code extension bundles the server and uses the official `vscode-languageclient` transport. It relies on the extension host's Node runtime.

PhpStorm reads only the path fields needed for host integration from a bounded `ppphp.json` file. It excludes compiler-owned output and cache directories from project-content indexing, validates that exclusions remain inside the project and do not overlap source or stub roots, and refreshes the project index when the configuration changes. For mixed PHP/++PHP projects, a filtered synthetic library restores native PHP visibility of generated declarations without restoring the entire output tree: the adapter accepts only safe `.php` outputs whose bounded compiler manifest entries identify them as compiled `.ppphp` sources. Copied PHP outputs and compiler metadata remain excluded. Missing or invalid manifests fail closed, and the project/output roots are watched so a subsequent build updates the library.

The PhpStorm plugin targets the 2025.2 compatibility baseline, uses bundled PHP tokenization for shallow PSI and native PHP lexical highlighting, and maps LSP semantic roles to PhpStorm's PHP color keys for parser-dependent PHP and ++PHP constructs. It registers the `.ppphp` language and starts the bundled server with a separately installed Node.js 22 runtime.

PhpStorm source-creation actions are host-native adapters rather than language-server behavior. They reuse PhpStorm's PHP/Composer namespace provider and PHP file-header template, then create independent `.ppphp` PSI files from PHP-shaped class, interface, trait, and enum templates. Language syntax is surfaced only when the compiler marks that feature active; currently the templates emit ordinary PHP declarations.

The ++PHP code-style provider delegates option definitions, labels, previews, and defaults to PhpStorm's bundled PHP provider, then remaps PHP-specific formatter fields onto a separate ++PHP settings object. PHPDoc, code-conversion, and code-generation panels use a private settings bridge so their controls remain native without modifying the PHP scheme. Compatibility tests require the ++PHP field contract to cover PhpStorm's PHP contract. A token-safe formatting model applies structural indentation, spacing, brace, and blank-line settings over the shallow PSI; interpolated strings and heredocs are opaque, and no PHP parser rewrite can damage ++PHP extensions. Generated class-family declarations consume the same common settings, and the canonical ++PHP default is a next-line class brace.

Completion import edits are planned in the editor-neutral server. VS Code supplies its explicit `ppphp.completion.importSorting` resource setting. PhpStorm exposes the current ++PHP `IMPORT_SORTING` scheme value through LSP workspace configuration, so choosing a completion inserts the short name and places the missing `use` statement consistently with the host setting.

## Capability policy

Completion snippets, contextual documentation, fallback extension tokens, and token-preserving layout formatting are non-semantic and may be served locally. Compiler diagnostics, definition identities, AST-backed semantic token roles, and project-wide rename remain compiler-authoritative. References and new semantic refactorings require explicit compiler protocol contracts before the server advertises them. An editor-neutral formatter remains a separate future protocol decision; the PhpStorm formatter does not rewrite tokens or claim semantic ownership.
