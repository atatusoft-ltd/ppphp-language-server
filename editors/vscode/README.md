# ++PHP for Visual Studio Code

This extension provides `.ppphp` syntax highlighting and connects Visual Studio Code to the ++PHP language server.

Extension releases use the quarterly CalVer shared by the ++PHP toolchain. The current version is `2026.3.1-rc-2`.

Compiler-core diagnostics run on current unsaved buffers after edits, with a 300ms debounce; save triggers an immediate refresh. This requires a compiler supporting `editor:diagnostics` version 1. Other open project buffers supply declaration context, and stale results are discarded. Supplemental PHPStan analysis still requires `ppphp check`. Configure `ppphp.compiler.path` if `ppphp` is not available at `vendor/bin/ppphp` or on `PATH`.

Completion suggestions are built from configured PHP/++PHP sources and stubs, Composer autoload metadata, installed dependencies, and the active PHP runtime. Class inheritance suggests inheritable classes, while interface inheritance and `implements` suggest interfaces. Existing imports and aliases are reused; otherwise completion adds a safe `use` statement or retains the fully qualified name when the short name would collide. Configure `ppphp.completion.importSorting` to place generated imports alphabetically, by qualified-name length, or after existing imports. A fully qualified type offers a `Use import` code action. An unresolved short type name offers an `Import class` action for each matching qualified name, after compiler verification that it is not a scoped symbol. These results are deterministic and do not use generated guesses. The native class-creation dialog is currently PhpStorm-only.

**Rename Symbol** performs a compiler-verified project-wide rename for ++PHP classes, interfaces, traits, and enums. When the declaration filename matches the type, the `.ppphp` file is renamed with it.

See the repository README for the current capability matrix and development instructions.
