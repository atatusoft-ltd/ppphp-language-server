# Editor Support

This document is the single tracked list of editors and IDEs that ++PHP intends to support, the shape each integration should take, and where each one stands today. The target line-up follows the website design, which is the agreed target for the Tools page, so that the public page and the engineering plan cannot drift apart. Later candidates are planning inputs, not public commitments.

Update this file whenever an integration changes status. The website Tools page must only present an integration as installable once it is listed here as **Available** with a published package.

## Status vocabulary

| Status         | Meaning                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Planned        | Agreed target. No source exists yet.                                                                                          |
| Source preview | Source is public in this repository and can be built locally. No packaged release is published.                               |
| Beta           | A packaged release is published through the editor's normal distribution channel, but coverage or stability is still limited. |
| Available      | A packaged release is published and is expected to work for everyday ++PHP development.                                       |

## Target line-up

The target for each editor is the experience described in the website design. The "target status" column records the status the design presents for that editor at launch, so the gap between the design and reality is explicit.

| Editor                       | Distribution                                                                             | Target status | Current status |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------- | -------------- |
| Visual Studio Code           | Marketplace extension (`ext install ppphp.ppphp-vscode`)                                 | Available     | Source preview |
| PhpStorm / IntelliJ          | JetBrains Marketplace plugin (`++PHP`)                                                   | Available     | Source preview |
| Neovim                       | Tree-sitter grammar plus an `nvim-lspconfig` entry for `vim.lsp.enable("ppphp")`         | Beta          | Planned        |
| Sublime Text                 | Syntax definition and LSP settings distributed through Package Control                   | Beta          | Planned        |
| Zed                          | Extension using the Tree-sitter grammar and locating or downloading the language server  | Beta          | Planned        |
| Language server (standalone) | `ppphp-ls`, speaking LSP over stdio, installable on its own so any LSP client can use it | Available     | Source preview |

## Delivery strategy

The next goal is not the largest possible editor list. It is to make the shared tooling dependable enough that adding an editor is mostly packaging and capability mapping rather than another implementation of ++PHP behavior.

### Phase 0: finish the two primary editors

Keep VS Code and PhpStorm as the only active editor-specific implementation tracks until both have published Beta packages. Close their current gaps first: editor-neutral formatting for VS Code parity, build/check commands, real-editor smoke tests, signed publishing, upgrade testing, and actionable toolchain-version mismatch reporting.

Publish the existing VSIX to both Visual Studio Marketplace and [Open VSX](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions). This extends the same adapter to VSCodium and other Open VSX consumers without creating a third editor implementation.

### Phase 1: make the shared server independently usable

Publish a versioned standalone distribution with a stable `ppphp-ls --stdio` entrypoint. The first distribution may be an npm package that declares its Node.js requirement; self-contained signed archives can follow if runtime installation proves to be a significant adoption barrier. Every distribution must also support `--version`, use the same CalVer as the compatible toolchain, and document project-local, configured-path, and `PATH` discovery in one consistent order.

Before adding an adapter, add a client-neutral protocol smoke suite and exercise it on Linux, macOS, Windows, and WSL. The suite must initialize the server with both rich and minimal client capabilities and cover workspace configuration, diagnostics, completion, hover, symbols, definition, semantic tokens, code actions, rename, shutdown, and malformed or unavailable toolchain responses.

### Phase 2: Neovim as the first new editor

Neovim is the first new adapter because it exercises the standalone distribution, a minimal LSP client, and the new Tree-sitter grammar at the same time. Initially ship a small configuration in this repository; propose it to [`nvim-lspconfig`](https://github.com/neovim/nvim-lspconfig) once ++PHP meets that project's adoption requirements. Current Neovim configuration uses `vim.lsp.config()` and `vim.lsp.enable()`, not the deprecated `require('lspconfig').…setup{}` interface.

### Phase 3: Sublime Text as the second new editor

Sublime follows Neovim. Its syntax and snippets can reuse the TextMate-family assets, while an [`LSP-ppphp`](https://lsp.sublimetext.io/) helper package can install or locate the standalone server and provide safe defaults. This is a deliberately thin integration; language intelligence remains in `ppphp-ls`.

### Phase 4: Zed, then Helix

Zed follows once the Tree-sitter grammar and server-download metadata have survived a Neovim release. [Zed requires a grammar for every language extension](https://zed.dev/docs/extensions/languages) and expects a language-server extension to download the server or find it in the user's environment rather than bundle it. The extension therefore needs a small Rust/Wasm adapter, pinned grammar revisions, checksums for downloaded server artifacts, and semantic-token mappings.

Helix is the next low-cost candidate after Zed. It can consume the same Tree-sitter grammar and standalone server through its [`languages.toml` registry](https://docs.helix-editor.com/guides/adding_languages.html), but it should not displace the three editors already promised by the public target line-up. Vim, Emacs, Eclipse, and other integrations remain community or demand-led until an owner and measurable user demand exist.

## Work-in-progress limits

- While VS Code and PhpStorm are below Beta, do not start production code for another editor. Shared standalone-server, grammar, protocol-test, and release work may proceed because it improves the primary editors too.
- After both primary editors reach Beta, allow one new editor adapter and one shared-infrastructure track at a time.
- After the first external adapter reaches Beta and the shared release pipeline is proven, at most two editor adapters may be active concurrently, and only with separate owners. Never put more than two new editors in one release wave.
- Add a language feature once in the compiler or language server, then map it into clients. Do not let editor schedules create independent semantic implementations.

## Per-editor scope

### Visual Studio Code

Syntax highlighting for `.ppphp`, inline diagnostics, hover types, go to definition, and build on save. Today the extension in `editors/vscode` provides highlighting, compiler diagnostics on open and save, deterministic completion, hover help, document symbols, go to definition, class-family rename, and use-import actions. Build on save and a Marketplace listing remain open.

### PhpStorm / IntelliJ

A native plugin with the `.ppphp` file type, structure view, refactoring across generics, and run configurations for `check` and `build`. Today the plugin in `editors/phpstorm` provides the file type, highlighting, diagnostics, completion, go to definition, formatting, code-style settings, file and class creation, and compiled-declaration resolution for mixed projects. Generic-aware refactoring beyond class-family rename, run configurations, and a JetBrains Marketplace listing remain open.

### Neovim

A Tree-sitter grammar and an `nvim-lspconfig` entry so `vim.lsp.enable("ppphp")` works with Neovim's built-in LSP client. Depends on the standalone language server distribution and on a Tree-sitter grammar, neither of which exists yet. The repository-owned preview configuration must remain usable before any upstream entry is accepted.

### Sublime Text

A syntax definition and LSP settings published through Package Control. The syntax definition can be derived from the canonical TextMate bundle in `res/textmate/ppphp`. Depends on the standalone language server distribution.

### Zed

An extension registering the Tree-sitter grammar and locating or downloading the language server. Zed extensions use Tree-sitter, so this shares the grammar prerequisite with Neovim, and it depends on a published standalone language server distribution.

### Helix

An upstream language entry, grammar revision, queries, and `ppphp-ls` configuration. Helix has built-in LSP support, so it needs no maintained client plugin once the shared grammar and standalone server are stable.

### Standalone language server

The editor-neutral server in `packages/language-server` already speaks LSP over stdio. What is missing is a distribution that does not require cloning this repository: a versioned package that installs `ppphp-ls` on the path. This is the prerequisite for every editor above other than VS Code and PhpStorm, which bundle the server.

## Shared prerequisites

- **Standalone `ppphp-ls` distribution.** Required by Neovim, Sublime Text, Zed, Helix, and any other LSP client. Editor packages should locate a project-local version before a configured path or `PATH`, and must report incompatible compiler/server versions without silently substituting another installation.
- **Remote and cross-platform execution contract.** Define where the server and compiler run for local, remote, container, SSH, Windows, and WSL workspaces. URI conversion, drive-letter case, UNC paths, symlinks, and file operations must be tested in the shared server rather than repaired separately in adapters. The stdio process must reserve standard output for LSP messages and send operational logs to standard error or the protocol log channel.
- **Client capability negotiation.** Treat `workspace/configuration`, workspace-folder lifecycle changes, semantic tokens, snippets, versioned document edits, and rename-file resource operations as optional. Advertise or perform an operation only when the client can apply it safely; retain the existing fail-closed behavior for partial rename support. Long-running compiler requests must also honor LSP cancellation.
- **Tree-sitter grammar and query corpus.** Required by Neovim, Zed, and Helix. TextMate and Tree-sitter solve different problems and should not be generated from each other. Keep them aligned through shared valid/invalid ++PHP corpus fixtures and semantic expectations, while the compiler remains authoritative for meaning.
- **Canonical configuration model.** Define editor-neutral names, types, defaults, and scopes once, then map them into VS Code settings, PhpStorm code style, and future client files. Editor-only controls such as PhpStorm class creation remain explicitly adapter-owned.
- **Editor-neutral formatting.** Standard LSP formatting and range-formatting are the route to consistent formatting outside PhpStorm. The server must not advertise them until a token-preserving formatter contract is ready.
- **Release metadata and update safety.** Generate package versions, compatibility ranges, server download URLs, checksums, and release notes from the repository's CalVer source of truth. Downloading adapters must verify checksums and never execute an unverified artifact.
- **Shared protocol and grammar tests.** Keep golden LSP transcripts, capability-matrix tests, grammar corpus tests, package-install smoke tests, and three-platform CI independent of any single editor UI.
- **Signed Marketplace and JetBrains Plugin Repository releases.** Required before VS Code or PhpStorm can move from Source preview to Beta or Available. See [releasing.md](releasing.md).

The canonical TextMate grammar can also feed Shiki-based documentation. GitHub Linguist recognition is a separate upstream integration and should follow a stable extension, grammar, and public repository footprint rather than block editor delivery.

## Capability tiers

Every adapter is expected to declare which tier it implements instead of implying parity from file recognition alone.

| Tier         | Required behavior                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Syntax       | `.ppphp` recognition, emblem where supported, comments, brackets, indentation, highlighting, and snippets                                                                |
| Standard LSP | Diagnostics, deterministic completion, hover, document symbols, definition, semantic tokens where supported, import code actions, and safe rename capability negotiation |
| Workflow     | Compiler discovery, version mismatch guidance, check/build commands, logs, restart, and workspace configuration                                                          |
| Host-native  | Creation dialogs, project indexing/exclusions, native formatting controls, run configurations, or other features that cannot be expressed portably through LSP           |

Beta requires a published normal-channel package, Syntax and Standard LSP coverage, install/upgrade documentation, and smoke coverage on every supported operating system. Available additionally requires the Workflow tier, a tested rollback path, a named maintainer, and no undocumented loss of shared language-server capabilities. Host-native features are optional and must be shown as editor-specific in the capability matrix.

## Adding an editor

Any client that speaks LSP can use `ppphp-ls` once the standalone distribution exists. An editor is added to this list, and to the website Tools page, only after an issue records demand, scope, distribution channel, maintenance owner, client capabilities, test plan, and shared prerequisites. Community integrations that are not maintained here are welcome but are not presented as official.

## Related

- [roadmap.md](roadmap.md) for the ordering of language-server features.
- [architecture.md](architecture.md) for the boundary between the compiler, the server, and editor adapters.
- [releasing.md](releasing.md) for the coordinated release checklist.
