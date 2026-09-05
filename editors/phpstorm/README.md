# ++PHP for PhpStorm

The PhpStorm plugin registers `.ppphp` as a distinct ++PHP language with shallow PSI, native PHP lexical highlighting, shared language-server semantic highlighting, and the ++PHP emblem. Every valid PHP token receives the same color key as it does in a `.php` file, while the language server layers ++PHP-specific types and keywords on top. PHP parsing and inspections do not interpret ++PHP source. The bundled ++PHP language server supplies authoritative compiler diagnostics through JetBrains native LSP integration.

For projects with `ppphp.json`, the configured compiler cache and non-compiled build artifacts are excluded from project-content indexing. The plugin reads `output/.ppphp/manifest.json` and exposes only entries marked as PHP compiled from `.ppphp` through a filtered PhpStorm library. Metadata, stale files, and native PHP files copied into the output stay excluded, preventing duplicate declarations while allowing ordinary `.php` code to resolve and complete ++PHP-authored classes.

Run `ppphp build` after adding or changing declarations that native PHP code consumes. PhpStorm watches the project and output roots and refreshes the synthetic library when the build manifest changes. A missing, unsupported, malformed, or unsafe manifest fails closed; it never causes the entire output tree to be indexed. Hand-written shadow stubs are not needed for mixed-project resolution. Unsafe paths that escape or overlap protected project directories are never excluded or exposed.

PhpStorm's **Refactor | Rename** action is available on ++PHP classes, interfaces, traits, and enums. The language server verifies every project occurrence through compiler symbol identity, updates references across configured source roots, and renames a matching `.ppphp` source file. Refactors that would collide, cross project boundaries, or require unsupported editor file operations are refused without partial edits.

Type completion reuses existing `use` imports and aliases, adding a safe import when no short-name collision exists. Generated imports follow the ++PHP import-sorting choice under code-conversion settings. A fully qualified type offers **Use import** through the intention menu; both behaviors come from the shared language server and therefore match VS Code.

## Creating source files

The Project view's **New** menu includes **++PHP File** and **++PHP Class**. Both actions always create `.ppphp` files and use the ++PHP emblem.

The class action follows PhpStorm's PHP creation workflow: choose a class, interface, trait, or enum; accept or edit the Composer/PSR namespace suggestion; optionally choose its PHP parent types; and choose `string` or `int` for a backed enum. The parent controls offer deterministic completion from ++PHP project sources, Composer dependencies, the active PHP runtime, and PhpStorm's PHP index; class and interface candidates are kept distinct, and final classes are excluded from `extends`. While the Name editor is focused, Up and Down cycle through declaration templates using PhpStorm's native template-cycling behavior. Generated declarations deliberately mirror PhpStorm's bundled PHP templates, including the configured PHP file header. The plugin does not insert inactive ++PHP syntax.

The plugin also adds **Editor | Code Style | ++PHP**. Its formatter, PHPDoc, code-conversion, and code-generation tabs mirror PhpStorm's PHP controls but store their values independently for ++PHP. Reformat Code and live Enter indentation apply the structural indentation, spacing, brace-placement, and blank-line choices through ++PHP's shallow PSI, preserving strings and ++PHP-only syntax rather than feeding the source to PHP's parser. Declaration creation reads the same values; class-family braces appear on a new line by default and follow the selected PHP-compatible class-brace placement and spacing options.

The filename defaults to the declaration name but can be changed independently. Namespace suggestions first use the nearest Composer manifest's canonical ++PHP source mappings (`extra.ppphp.source-autoload` and `extra.ppphp.source-autoload-dev`). When no source mapping applies, they fall back to PhpStorm's PHP project model. This keeps creation correct after `ppphp composer:configure` moves Composer's runtime mappings to generated PHP while requiring no editor-only namespace configuration.

Plugin releases use the quarterly CalVer shared by the ++PHP toolchain. The current target is `2026.3.1-rc-2`.

## Local requirements

- PhpStorm 2025.2 or newer
- Node.js 22 or newer
- The `ppphp` compiler in the project at `vendor/bin/ppphp`, on `PATH`, or configured through `PPPHP_COMPILER_PATH`

The plugin uses the project's local Node.js runtime configured under **Settings → Languages & Frameworks → JavaScript Runtime**. This also works when PhpStorm is started from the desktop and does not inherit the path used by nvm, fnm, or another shell version manager. `PPPHP_NODE_PATH` and the following custom VM option remain available as explicit overrides:

```text
-Dppphp.language.server.node.path=/absolute/path/to/node
```

On Windows, PHP must also be available as `php.exe` on the IDE's effective `PATH`. Set `PPPHP_PHP_PATH` to an absolute PHP executable path when using a desktop or version-manager installation that PhpStorm does not inherit. The language server runs Composer's PHP proxy directly and never constructs a shell command from project paths.

After installing or updating the plugin from disk, restart PhpStorm so the `.ppphp` language association is refreshed.

## Troubleshooting blank code-style previews

If code-style previews are blank, check **Help → Show Log in Finder/Explorer** for errors before changing formatting settings. An `IElementType.TooManyElementTypesException` (shown in logs as `IElementType$TooManyElementTypesException`) means the IDE-wide element-type registry is exhausted; it can break indexing and newly created previews across languages. Fully restart PhpStorm, not just the ++PHP language server. If it recurs, inspect the first registry-exhaustion entry for the language registering excessive element types and report it to that plugin's maintainer. Reinstalling ++PHP or changing indentation preferences does not repair an exhausted registry in a running IDE.

## Windows and WSL smoke test

Before release, install the built plugin in a supported PhpStorm version on Windows and open the same ++PHP project through WSL. Confirm that:

- no ++PHP plugin exception or `ProviderMismatchException` is reported;
- indexing completes, the Project view remains usable, and Composer support loads normally;
- the compiler cache and non-compiled build artifacts are excluded, while compiled ++PHP declarations, `src`, `app`, stubs, vendor, and `ppphp.json` remain indexed;
- native PHP references resolve declarations compiled from `.ppphp`, while copied PHP outputs do not create duplicate declarations;
- changing `ppphp.json` refreshes the effective exclusions without repeated failures;
- opening and saving `.ppphp` files still starts diagnostics;
- definition, completion, hover, symbols, and class-family rename continue to work; and
- restarting PhpStorm leaves startup and indexing clean.

Build the distributable plugin from the repository root with:

```shell
./editors/phpstorm/gradlew -p editors/phpstorm buildPlugin
```
