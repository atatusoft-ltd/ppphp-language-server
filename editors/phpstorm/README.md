# ++PHP for PhpStorm

The PhpStorm plugin registers `.ppp` as a dialect of PhpStorm's native PHP language, adds ++PHP contextual-keyword highlighting and the ++PHP emblem, then starts the bundled ++PHP language server through JetBrains' native LSP integration.

For projects with `ppphp.json`, the configured compiler-owned `output` and `cache` directories are automatically excluded from PhpStorm indexing. This keeps emitted `.php` files from appearing as duplicate declarations of their `.ppp` sources. Unsafe paths that escape or overlap protected project directories are never excluded.

Plugin releases track the ++PHP toolchain's Doria-style CalVer. The current target is `2026.3.1`.

## Local requirements

- PhpStorm 2026.2 or newer
- Node.js 22 or newer
- The `ppphp` compiler in the project at `vendor/bin/ppphp`, on `PATH`, or configured through `PPPHP_COMPILER_PATH`

PhpStorm started from the desktop may not inherit your shell's Node.js path. Set `PPPHP_NODE_PATH` before starting PhpStorm, or add this line under **Help → Edit Custom VM Options**:

```text
-Dppphp.language.server.node.path=/absolute/path/to/node
```

After installing or updating the plugin from disk, restart PhpStorm so the `.ppp` language association is refreshed.

Build the distributable plugin from the repository root with:

```shell
./editors/phpstorm/gradlew -p editors/phpstorm buildPlugin
```
