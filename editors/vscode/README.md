# ++PHP for Visual Studio Code

This extension provides `.ppphp` syntax highlighting and connects Visual Studio Code to the ++PHP language server.

Extension releases use the quarterly CalVer shared by the ++PHP toolchain. The current version is `2026.3.1`.

Compiler diagnostics run when a document is opened or saved. Configure `ppphp.compiler.path` if `ppphp` is not available at `vendor/bin/ppphp` or on `PATH`.

**Rename Symbol** performs a compiler-verified project-wide rename for ++PHP classes, interfaces, traits, and enums. When the declaration filename matches the type, the `.ppphp` file is renamed with it.

See the repository README for the current capability matrix and development instructions.
