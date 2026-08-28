# ++PHP for PhpStorm

The PhpStorm plugin registers `.phplus` syntax highlighting from the shared TextMate bundle and starts the bundled ++PHP language server through JetBrains' native LSP integration.

## Local requirements

- PhpStorm 2026.2 or newer
- Node.js 22 or newer
- The `ppphp` compiler in the project at `vendor/bin/ppphp`, on `PATH`, or configured through `PPPHP_COMPILER_PATH`

PhpStorm started from the desktop may not inherit your shell's Node.js path. Set `PPPHP_NODE_PATH` before starting PhpStorm, or add this line under **Help → Edit Custom VM Options**:

```text
-Dppphp.language.server.node.path=/absolute/path/to/node
```

Build the distributable plugin from the repository root with:

```shell
./editors/phpstorm/gradlew -p editors/phpstorm buildPlugin
```
