# ++PHP for Visual Studio Code

This extension provides `.ppp` syntax highlighting and connects Visual Studio Code to the ++PHP language server.

Extension releases track the ++PHP toolchain's Doria-style CalVer. The current canonical target is `2026.03.1-canary`; the VS Code manifest encodes it as `2026.3.1-canary` because its numeric quarter must be SemVer-compatible.

Compiler diagnostics run when a document is opened or saved. Configure `ppphp.compiler.path` if `ppphp` is not available at `vendor/bin/ppphp` or on `PATH`.

See the repository README for the current capability matrix and development instructions.
