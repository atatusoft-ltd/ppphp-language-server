# ++PHP for Zed

Language support for `.ppphp` files: native type and generic highlighting, comments, bracket matching, indentation, outline, text objects, and the shared ++PHP language server.

## Installation and distribution

The registry entry is not published yet. Before publication, maintainers must publish the versioned language-server asset described in [Releasing](../../docs/releasing.md#zed-distribution). Source installation is available below.

Once published, users install **++PHP** from Zed's extension registry and open their project. They do not need this repository, Rust, npm, a manually built server, or absolute executable paths.

Zed distributes the compiled extension and ++PHP Tree-sitter grammar. Native highlighting covers built-in and named types, nested generics, generic parameters and bounds, typed locals, `throws`, and `when`. These colors work immediately, including when the language server or compiler is unavailable.

On first language-server startup, the adapter obtains Node.js through Zed and downloads the standalone `server.cjs` for the extension's exact tooling version from this repository's GitHub release. It verifies the download against the release's `SHA256SUMS`, stores it in the extension host's cache, and verifies the cached copy before reusing it offline. Upgrades use a separate version directory. Interrupted downloads are discarded.

For WSL/SSH projects, installation and execution happen on the project host. Windows paths are never reused on a Linux host. The first install needs access to the release download and Zed's Node.js runtime.

Compiler-backed diagnostics, definition, completion, and safe edits require the compatible ++PHP compiler in the project or on that host's PATH; see the [runtime prerequisites](../../README.md#requirements). The extension does not install or change project Composer dependencies. Basic highlighting and the server's fallback features remain usable without a compiler.

## Optional settings

For additional compiler-owned semantic roles, enable semantic tokens:

```json
{
  "languages": {
    "++PHP": {
      "semantic_tokens": "combined"
    }
  }
}
```

This supplements the native grammar using your existing theme. Zed's [semantic tokens](https://zed.dev/docs/extensions/languages#syntax-highlighting-with-semantic-tokens) are optional for type and generic syntax colors.

Project settings can also configure the compiler and shared server:

```json
{
  "lsp": {
    "ppphp-ls": {
      "settings": {
        "ppphp": {
          "completion": {
            "importSorting": "alphabetic"
          },
          "diagnostics": {
            "compiler": {
              "enabled": true,
              "timeoutMilliseconds": 10000
            }
          }
        }
      }
    }
  }
}
```

For a compiler override, add `"compiler": { "path": "/absolute/path/to/ppphp" }` inside `settings.ppphp`. `PPPHP_COMPILER_PATH` and `PPPHP_PHP_PATH` remain available.

Only `.ppphp` files are associated automatically. The language is named `++PHP`, the language-server key is `ppphp-ls`, and the LSP language ID is `ppphp`.

## Server overrides and development

Discovery is worktree-local, in this order:

1. An explicit `lsp.ppphp-ls.binary.path`, with `binary.arguments` and `binary.env`.
2. `node_modules/@ppphp/language-server/dist/server.cjs` under the worktree root, launched with that host's Node.js.
3. `packages/language-server/dist/server.cjs` under the worktree root, for development in this repository.
4. A `ppphp-ls` executable on the project host's PATH.
5. The automatically installed, versioned server with Zed's Node.js runtime.

An explicit command is authoritative; startup errors do not silently select another server. Arguments default to `--stdio`; custom arguments replace that default, and an explicit empty list is preserved. Discovered bundles prepend the bundle path. Environment overrides are applied per worktree.

The npm package is private; the project-local discovery path supports locally linked development copies. Production installation uses the GitHub release asset.

Before the first server release is published, source developers can build with `php scripts/build.php server` and use an override on the project host:

```json
{
  "lsp": {
    "ppphp-ls": {
      "binary": {
        "path": "/absolute/path/to/node",
        "arguments": ["/absolute/path/to/server.cjs", "--stdio"]
      }
    }
  }
}
```

Use JSON-escaped Windows paths such as `C:\\tools\\nodejs\\node.exe`. WSL/SSH overrides use paths on the project host. After rebuilding the server, run **editor: restart language server**.

## Install a development extension

Source developers need [Rust through rustup](https://www.rust-lang.org/tools/install). End users of the published extension do not.

On Linux/macOS, from the repository root:

```shell
rustup target add wasm32-wasip2
php scripts/build.php zed
```

In Zed, run **zed: install dev extension** and select `editors/zed`. Zed compiles the adapter and the pinned ++PHP grammar.

### Windows and WSL checkouts

Install Rust through Windows rustup when running Windows Zed. A WSL Rust installation is separate.

Long paths can cause MSVC `LNK1104` errors for Rust build-script objects. Zed explicitly builds inside the selected extension's `target` directory, so `CARGO_TARGET_DIR` does not shorten its paths. Use Windows PHP from PowerShell to prepare a short native source directory:

```powershell
rustup target add wasm32-wasip2
php scripts/build.php zed-dev
```

Select the printed directory in **zed: install dev extension**, normally `%LOCALAPPDATA%\ppphp\zed-dev`. Re-run `zed-dev` after changing source, then rebuild the dev extension. It refreshes source and preserves Zed's build caches. On Linux/macOS, this staging command uses `build/zed-dev`.

The repository's `zed-check`, `zed`, `editors`, and `all` targets use a short native Cargo target directory on Windows as well. UNC checkouts are temporarily mapped to a Windows drive for the complete build so npm and Gradle also retain the working directory. The mapping is released on completion or failure. Build the server on the machine hosting the project. Keep Windows and WSL `node_modules` installations separate: Windows npm cannot reuse Linux workspace links.

For installation errors, run **zed: open log**. See [Zed extension development](https://zed.dev/docs/extensions/developing-extensions) for grammar build prerequisites.

## Verification and limits

```shell
npm run check
php scripts/build.php zed-grammar
php scripts/build.php zed
php scripts/build.php server-release
```

Tests cover native PHP/++PHP parsing, type and generic captures without LSP, operator/bracket distinctions, every editing query, stdio LSP behavior, command overrides, Windows paths, worktree isolation, and managed installation/cache failures. CI regenerates the parser and builds on Linux and Windows.

Before publication, test a clean Zed profile against the actual published server asset:

- Install through the registry and open a project outside this repository with no server override.
- Confirm type/generic colors with semantic tokens off and no compiler installed.
- Verify automatic runtime/server installation, then restart offline using the cache.
- Repeat on native Windows and a WSL/SSH host; verify paths and caches remain host-local.
- With the compatible project compiler, check diagnostics, completion, hover, definition, imports, and safe class-family rename.
- Enable semantic tokens and confirm they supplement native colors.
- Test an interrupted first download and a subsequent successful retry.

Tree-sitter supplies editing structure, not semantic validation. The compiler remains authoritative for correctness and safe edits. Formatting, class-creation dialogs, and PhpStorm-specific generated-PHP indexing are not supplied by this adapter.

Generated build outputs and caches are ignored. Keep the lockfile and generated grammar sources checked in.
