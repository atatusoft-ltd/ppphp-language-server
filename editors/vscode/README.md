# ++PHP for Visual Studio Code

This extension provides `.ppphp` syntax highlighting and connects Visual Studio Code to the ++PHP language server.

Extension releases use the quarterly CalVer shared by the ++PHP toolchain. The current version is `2026.3.1`.

Compiler diagnostics run when a document is opened or saved. Configure `ppphp.compiler.path` if `ppphp` is not available at `vendor/bin/ppphp` or on `PATH`.

Completion suggestions are built from configured ++PHP sources, Composer autoload metadata, installed dependencies, and the active PHP runtime. Class inheritance suggests inheritable classes, while interface inheritance and `implements` suggest interfaces. Existing imports and aliases are reused; otherwise completion adds a safe import or retains the fully qualified name when the short name would collide. A fully qualified type offers a `Use import` Quick Fix. These results are deterministic and do not use generated guesses.

**Rename Symbol** performs a compiler-verified project-wide rename for ++PHP classes, interfaces, traits, and enums. When the declaration filename matches the type, the `.ppphp` file is renamed with it.

See the repository README for the current capability matrix and development instructions.
