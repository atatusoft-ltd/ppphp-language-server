# ++PHP for PhpStorm

The PhpStorm plugin registers `.ppphp` as a distinct ++PHP language with shallow PSI, native PHP lexical highlighting, shared language-server semantic highlighting, and the ++PHP emblem. Every valid PHP token receives the same color key as it does in a `.php` file, while the language server layers ++PHP-specific types and keywords on top. PHP parsing and inspections do not interpret ++PHP source. The bundled ++PHP language server supplies authoritative compiler diagnostics through JetBrains native LSP integration.

For projects with `ppphp.json`, the configured compiler-owned `output` and `cache` directories are automatically excluded from PhpStorm indexing. This keeps emitted `.php` files from appearing as duplicate declarations of their `.ppphp` sources. Unsafe paths that escape or overlap protected project directories are never excluded.

PhpStorm's **Refactor | Rename** action is available on ++PHP classes, interfaces, traits, and enums. The language server verifies every project occurrence through compiler symbol identity, updates references across configured source roots, and renames a matching `.ppphp` source file. Refactors that would collide, cross project boundaries, or require unsupported editor file operations are refused without partial edits.

## Creating source files

The Project view's **New** menu includes **++PHP File** and **++PHP Class**. Both actions always create `.ppphp` files and use the ++PHP emblem.

The class action follows PhpStorm's PHP creation workflow: choose a class, interface, trait, or enum; accept or edit the Composer/PSR namespace suggestion; optionally choose its PHP parent types; and choose `string` or `int` for a backed enum. While the Name editor is focused, Up and Down cycle through declaration templates using PhpStorm's native template-cycling behavior. Generated declarations deliberately mirror PhpStorm's bundled PHP templates, including the configured PHP file header. The plugin does not insert inactive ++PHP syntax.

The plugin also adds **Editor | Code Style | ++PHP**. Its formatter, PHPDoc, code-conversion, and code-generation tabs mirror PhpStorm's PHP controls but store their values independently for ++PHP. Declaration creation reads those values; class-family braces appear on a new line by default and follow the selected PHP-compatible class-brace placement and spacing options.

The filename defaults to the declaration name but can be changed independently. Namespace suggestions first use the nearest Composer manifest's canonical ++PHP source mappings (`extra.ppphp.source-autoload` and `extra.ppphp.source-autoload-dev`). When no source mapping applies, they fall back to PhpStorm's PHP project model. This keeps creation correct after `ppphp composer:configure` moves Composer's runtime mappings to generated PHP while requiring no editor-only namespace configuration.

Plugin releases use the quarterly CalVer shared by the ++PHP toolchain. The current target is `2026.3.1`.

## Local requirements

- PhpStorm 2025.2 or newer
- Node.js 22 or newer
- The `ppphp` compiler in the project at `vendor/bin/ppphp`, on `PATH`, or configured through `PPPHP_COMPILER_PATH`

PhpStorm started from the desktop may not inherit your shell's Node.js path. Set `PPPHP_NODE_PATH` before starting PhpStorm, or add this line under **Help → Edit Custom VM Options**:

```text
-Dppphp.language.server.node.path=/absolute/path/to/node
```

After installing or updating the plugin from disk, restart PhpStorm so the `.ppphp` language association is refreshed.

## Windows and WSL smoke test

Before release, install the built plugin in a supported PhpStorm version on Windows and open the same ++PHP project through WSL. Confirm that:

- no ++PHP plugin exception or `ProviderMismatchException` is reported;
- indexing completes, the Project view remains usable, and Composer support loads normally;
- only the configured compiler `output` and `cache` directories are excluded, while `src`, `app`, stubs, vendor, and `ppphp.json` remain indexed;
- changing `ppphp.json` refreshes the effective exclusions without repeated failures;
- opening and saving `.ppphp` files still starts diagnostics;
- definition, completion, hover, symbols, and class-family rename continue to work; and
- restarting PhpStorm leaves startup and indexing clean.

Build the distributable plugin from the repository root with:

```shell
./editors/phpstorm/gradlew -p editors/phpstorm buildPlugin
```
