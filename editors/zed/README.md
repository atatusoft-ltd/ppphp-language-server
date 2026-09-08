# ++PHP for Zed

Language support for `.ppphp` files using the shared ++PHP language server.

The extension provides file recognition, PHP baseline highlighting, comments, bracket matching, indentation, outline, and Vim text objects. The language server supplies compiler diagnostics, deterministic completion, keyword hover, document symbols, definition, semantic tokens, import actions, and safe class-family rename where the client supports the required workspace edits.

This is a local source integration. It has not been published in Zed's extension registry.

## Install from source

Install the repository's [runtime prerequisites](../../README.md#requirements), plus [Rust through rustup](https://www.rust-lang.org/tools/install). Zed needs Rust installed through rustup to build development extensions.

On Linux/macOS, from the repository root (Windows users should follow the next section):

```shell
rustup target add wasm32-wasip2
php scripts/build.php zed
```

This runs Rust formatting and adapter/grammar tests, builds the shared server, and produces `editors/zed/extension.wasm`. In Zed, run **zed: install dev extension** and select the **editors/zed** directory. Zed builds the extension and fetches the pinned Tree-sitter grammar. For grammar build prerequisites, see [Zed extension development](https://zed.dev/docs/extensions/developing-extensions).

For a ++PHP project outside this repository, configure the server as shown below. Opening the language-server repository itself automatically finds its built server.

### Windows, including repositories in WSL

When running Windows Zed, install Rust through **Windows rustup**. A WSL Rust installation is separate. Long repository paths and WSL UNC paths can make MSVC fail with `LNK1104` while linking Rust build scripts, even when the object file exists. Zed always builds inside the selected extension directory, so setting `CARGO_TARGET_DIR` does not shorten its build paths.

From **Windows PowerShell** at the repository root, using Windows PHP:

```powershell
rustup target add wasm32-wasip2
php scripts/build.php zed-dev
```

In Zed, run **zed: install dev extension** and select the printed directory, normally `%LOCALAPPDATA%\ppphp\zed-dev`. This command copies the extension source to a short native path, preserving Zed's build caches on subsequent runs. Edit the repository files and run `zed-dev` again before rebuilding the installed extension. On Linux/macOS the command stages into `build/zed-dev`.

Build the shared server with `php scripts/build.php server` on the machine that hosts your project. For a WSL project, run that command in WSL and open the project using Zed's WSL connection. Server discovery uses the project host; the local extension copy does not contain a server bundle.

If installation still fails, run **zed: open log** for the underlying Cargo error. Verify the same development build in PowerShell:

```powershell
$extension = Join-Path $env:LOCALAPPDATA 'ppphp\zed-dev'
Push-Location $extension
cargo build --locked --target wasm32-wasip2 --target-dir "$extension\target"
Pop-Location
```

## Configure Zed

Merge this into Zed's settings, replacing both absolute paths with paths on the machine that hosts your project:

```json
{
  "languages": {
    "++PHP": {
      "semantic_tokens": "combined"
    }
  },
  "lsp": {
    "ppphp-ls": {
      "binary": {
        "path": "/absolute/path/to/node",
        "arguments": [
          "/absolute/path/to/ppphp-language-server/packages/language-server/dist/server.cjs",
          "--stdio"
        ]
      },
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

The language is named `++PHP`, the Zed language-server key is `ppphp-ls`, and the LSP document language ID is `ppphp`. Only `.ppphp` files are associated automatically; ordinary PHP files retain their own language support.

Zed's [semantic token setting](https://zed.dev/docs/extensions/languages#syntax-highlighting-with-semantic-tokens) must be enabled for compiler-owned ++PHP roles. Use `combined` to keep lexical string, comment, and punctuation colors alongside semantic tokens. This works with your existing theme.

The `settings.ppphp` object is returned when the server requests its `ppphp` configuration section. For a compiler override, add `"compiler": { "path": "/absolute/path/to/ppphp" }` inside that object. Otherwise, the shared server discovers the compiler in the project or environment. Compiler and PHP overrides through `PPPHP_COMPILER_PATH` and `PPPHP_PHP_PATH` remain available, including through `binary.env`.

On Windows use JSON-escaped paths such as `C:\\tools\\nodejs\\node.exe`. For remote or WSL projects, configure executables and server paths on that project's host. Rebuild the server after updating this checkout, and use Zed's **editor: restart language server** action.

## Server discovery

Discovery is repeated independently for each worktree, in this order:

1. An explicit `lsp.ppphp-ls.binary.path`, with `binary.arguments` and `binary.env`.
2. `node_modules/@ppphp/language-server/dist/server.cjs` under the worktree root, launched with that host's `node`.
3. `packages/language-server/dist/server.cjs` under the worktree root, for development in this repository.
4. A `ppphp-ls` executable on the worktree host's `PATH`.

The default arguments are `--stdio`. Custom arguments replace that default; for a discovered bundle the bundle path is always prepended. An explicit empty argument list is preserved. A configured command is authoritative; startup failures do not silently select a different server.

The npm package is currently private. The project-local path supports a locally linked package; it is not an instruction to install an unpublished npm package. The extension neither bundles a server inside Wasm nor downloads one. An unavailable server produces setup guidance in Zed's language-server status/log.

## Limits

The pinned PHP Tree-sitter grammar is a lexical baseline, not a complete ++PHP parser. Generics, typed locals, checked errors, and `when` expressions can cause parser recovery; outline, indentation, bracket matching, and text objects may be incomplete near those constructs. The shared server supplies ++PHP semantics and remains the authority for diagnostics and edits. A dedicated ++PHP Tree-sitter grammar is future work.

Formatting is not supplied by this extension or the shared server. Class-creation dialogs, compiler build/check tasks, and PhpStorm's generated-PHP indexing are editor-specific features and are not implemented here. Rename remains subject to compiler verification and the server's client-capability checks.

## Verification

```shell
npm run check
npm run check:zed
php scripts/build.php zed
```

Rust tests exercise configured commands, argument boundaries, environment overrides, local/PATH discovery, missing dependencies, Windows paths, and worktree isolation. The language tests compile every query against the exact grammar revision in `extension.toml`, exercise the shared ++PHP fixture, and check metadata and semantic-token coverage. CI also builds the Wasm target on Linux and compiles the staged dev extension with the native Windows toolchain. The release build uses an explicit `editors/zed/target` directory for reliable artifact copying.

Before publication, complete a real-editor smoke test on each supported project host:

- Install the dev extension and open `editors/fixtures/recognized-syntax.ppphp`; verify the language is `++PHP` and regular `.php` files remain PHP.
- Verify comments, strings, brackets, indentation, outline, completion, hover, and semantic highlighting with `semantic_tokens: combined`.
- With the compatible compiler installed in a sample project, verify unsaved diagnostics, definition, safe imports, and class-family rename, including a source-file rename.
- Change compiler configuration and restart the server; verify the chosen settings take effect.
- Open two worktrees with different server/compiler paths; confirm each uses its own host and configuration.
- Verify missing server/runtime errors give setup guidance, then restore the configuration and restart.

Build outputs, grammar checkouts, and `target/` are ignored. Keep `Cargo.lock` checked in. All adapter versions track the repository's `VERSION`.
