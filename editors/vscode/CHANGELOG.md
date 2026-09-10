# Changelog

## Unreleased

## 2026.3.4 - 2026-09-10

- Replace obsolete source errors with an explicit current-document analysis-unavailable warning when the compiler fails. Successful analysis clears it; repeated failures do not flood notifications.
- Report compiler memory exhaustion and process failures accurately instead of suggesting an unsupported protocol. Compiler selection, project pins and memory settings remain unchanged.

## 2026.3.3 - 2026-09-10

- Preserve the selected editor memory limit when the compiler applies its own defaults, without changing the parent editor environment.
- Default editor-launched compiler processes to a 512 MiB PHP memory limit. Adjust `ppphp.compiler.memoryLimitMegabytes` in Settings; live workers restart automatically and no `php.ini` edit is needed.

## 2026.3.2 - 2026-09-08

- Advance the numeric tooling release without changing compiler compatibility.
- Direct setup to the published compatible compiler's installation instructions, replacing obsolete package-publication blockers. Stable and compiler-candidate installation remain distinct.
- Use the canonical Composer package `atatusoft/ppphp` in setup instructions. See the [compiler installation guide](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/compiler-installation.md) for publication prerequisites and migration from the former package name; project-local compiler discovery is unchanged.
- Require dated release notes when validating and packaging a release.

## 2026.3.1 - 2026-09-08

- Use a numeric extension release version independently of compiler release-candidate metadata, and match the registered Marketplace publisher ID.
- When replacing an older sideloaded `Atatusoft.ppphp-vscode` extension, uninstall that copy before installing `AtatusoftLtd.ppphp-vscode` to avoid running duplicate language servers.
- Add compiler-verified project-wide rename for ++PHP class-family declarations and references.
- Preserve native PHP highlighting for `$this` and PHP superglobals.
- Add deterministic project, Composer dependency, and PHP runtime type completion.
- Reuse existing imports during completion, add safely ordered imports for external types, and offer a `Use import` Quick Fix for fully qualified types.
- Show the specific compiler diagnostic first in the Problems panel.

## 0.1.1

- Use the canonical ++PHP emblem for the extension and `.ppphp` files.
- Replace the retired file association with `.ppphp`.

## 0.1.0

- Initial local development release.
