# ++PHP for PhpStorm

The PhpStorm plugin registers `.ppphp` as a distinct ++PHP language with its own presentation lexer, parser, PSI, syntax highlighting, and emblem. Ordinary PHP tokens retain PhpStorm's familiar PHP colors, but PHP parsing and inspections do not interpret ++PHP source. The bundled ++PHP language server supplies authoritative compiler diagnostics through JetBrains' native LSP integration.

For projects with `ppphp.json`, the configured compiler-owned `output` and `cache` directories are automatically excluded from PhpStorm indexing. This keeps emitted `.php` files from appearing as duplicate declarations of their `.ppphp` sources. Unsafe paths that escape or overlap protected project directories are never excluded.

Plugin releases track the ++PHP toolchain's Doria-style CalVer. The current target is `2026.3.1`.

## Local requirements

- PhpStorm 2025.2 or newer
- Node.js 22 or newer
- The `ppphp` compiler in the project at `vendor/bin/ppphp`, on `PATH`, or configured through `PPPHP_COMPILER_PATH`

PhpStorm started from the desktop may not inherit your shell's Node.js path. Set `PPPHP_NODE_PATH` before starting PhpStorm, or add this line under **Help → Edit Custom VM Options**:

```text
-Dppphp.language.server.node.path=/absolute/path/to/node
```

After installing or updating the plugin from disk, restart PhpStorm so the `.ppphp` language association is refreshed.

Build the distributable plugin from the repository root with:

```shell
./editors/phpstorm/gradlew -p editors/phpstorm buildPlugin
```
