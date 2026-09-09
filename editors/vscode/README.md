# ++PHP for Visual Studio Code

[![Checks](https://img.shields.io/github/actions/workflow/status/atatusoft-ltd/ppphp-language-server/ci.yml?branch=main&label=checks)](https://github.com/atatusoft-ltd/ppphp-language-server/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache](https://img.shields.io/badge/license-Apache-blue)](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/LICENSE)

Language support for [++PHP](https://ppphplang.org), a superset of PHP that compiles to PHP. Write `.ppphp` files with syntax highlighting, compiler diagnostics, deterministic type completion, and code navigation in Visual Studio Code.

## Features

- **Syntax highlighting** for PHP syntax and ++PHP constructs, with compiler-backed semantic highlighting.
- **Type completion and automatic imports** from your project, Composer dependencies, configured stubs, and PHP built-ins. Existing imports and aliases are reused; new imports follow your chosen ordering.
- **Context-aware parent suggestions** that distinguish inheritable classes from interfaces when writing `extends` and `implements`.
- **Live diagnostics** that check unsaved edits after a short typing pause and refresh immediately on save.
- **Go to Definition** for project types, functions, variables, parameters, and supported member-access chains.
- **Rename Symbol** for classes, interfaces, traits, and enums, including matching declaration filenames when safe.
- **Import actions** to shorten fully qualified types or choose an import for an unresolved type name.
- **Document outline and keyword hover** to navigate declarations and learn about ++PHP constructs.

Completion uses known symbols, not generated guesses. The extension bundles its language server; the ++PHP compiler is installed separately in your project.

## Quick start

1. Install **++PHP** by **Atatusoft Ltd** from the Extensions view in VS Code.
2. Open your project folder and install the compiler using this extension release's [compatible compiler installation instructions](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CHANGELOG.md#installing-a-release-candidate). For an existing checkout, run `composer install` in the integrated terminal to restore its locked dependencies instead.
3. For a new ++PHP project, create its configuration:

   ```shell
   vendor/bin/ppphp init
   ```

4. Open a `.ppphp` file. The extension starts automatically; the language mode should show **++PHP**.

For PHP and Composer prerequisites and the complete build workflow, see the [getting-started guide](https://github.com/atatusoft-ltd/ppphp-src/blob/main/docs/getting-started.md). For an existing checkout, run `composer install` to restore its dependencies instead of adding the compiler again.

For stable installation, updates, or migration from the former Composer package name, see the [compiler installation guide](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/compiler-installation.md).

The project-local compiler at `vendor/bin/ppphp` is discovered automatically. You can also use a compiler on `PATH` or configure an absolute path with `ppphp.compiler.path`. On Windows, PHP must be available to VS Code; `PPPHP_PHP_PATH` can identify the PHP executable when it is not on `PATH`.

### Installing a release candidate

To use a compiler candidate, check the installed extension's version in the Extensions view and consult its [compiler compatibility and candidate installation notes](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CHANGELOG.md#installing-a-release-candidate). Choose that release entry, not simply the newest compiler candidate. Compiler candidates do not change the extension's release channel.

## Using the extension

Use VS Code's standard **Go to Definition**, **Rename Symbol**, and **Quick Fix…** actions from the editor's context menu. Import actions appear without requiring a diagnostic on the selected fully qualified type. If several types share an unresolved short name, choose the qualified name you intend to import.

Open the folder containing `ppphp.json` to give the tools the project's source and exclusion boundaries. Project-wide rename requires that configuration. The extension handles `.ppphp` files; keep your existing PHP tooling for ordinary `.php` files in mixed projects.

Live diagnostics report the compiler's own findings. Run `vendor/bin/ppphp check` for the complete saved-project check, including supplemental PHPStan analysis when configured. The extension does not build your application automatically.

## Settings

Open VS Code Settings and search for `ppphp`. These settings can also be configured per workspace:

| Setting                                          | Default      | Purpose                                                                                                                     |
| ------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ppphp.compiler.path`                            | Empty        | Use an absolute compiler path instead of automatic discovery.                                                               |
| `ppphp.compiler.memoryLimitMegabytes`            | `512`        | PHP memory limit in MiB for each compiler process. Changes also restart live diagnostics workers.                           |
| `ppphp.completion.importSorting`                 | `alphabetic` | Order added imports alphabetically, by qualified-name `length`, or append them with `none`. Existing imports are preserved. |
| `ppphp.diagnostics.compiler.enabled`             | `true`       | Enable live compiler diagnostics.                                                                                           |
| `ppphp.diagnostics.compiler.timeoutMilliseconds` | `10000`      | Limit the duration of a compiler diagnostic request.                                                                        |

The memory setting applies to editor-launched compiler calls, including diagnostics and navigation. It does not change `php.ini` or commands you run separately in a terminal. If you use a custom shell wrapper, point `ppphp.compiler.path` at its underlying PHP compiler script for this setting to apply.

For example, to order added imports by length:

```json
{
  "ppphp.completion.importSorting": "length"
}
```

## Troubleshooting

- **No highlighting or suggestions?** Save the file with the `.ppphp` extension and check that its language mode is **++PHP**. Do not associate these files with the ordinary PHP language mode.
- **Compiler unavailable?** Confirm that `vendor/bin/ppphp --version` runs from the project terminal. Check `ppphp.compiler.path` and the PHP executable visible to VS Code.
- **Unsaved-buffer diagnostics unavailable?** Check [compiler compatibility and installation instructions](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CHANGELOG.md#installing-a-release-candidate) first. Use `composer update atatusoft/ppphp` to update within your existing constraint; an exact older candidate pin must be changed using the matching release's installation command. If the project still requires the former package name, follow the [migration steps](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/compiler-installation.md#migrating-from-the-former-package-name) instead. Do not treat a saved-file check as analysis of unsaved edits.
- **Need more detail?** Open **View → Output** and select **++PHP Language Server**. After changing the environment or installing tools, run **Developer: Reload Window** from the Command Palette.

The extension does not currently provide formatting, debugging, signature help, or rename for functions, methods, properties, and variables. It requires a desktop extension host that can run the compiler; browser-only workspaces are not supported.

## Feedback and support

Report bugs or request features in the [issue tracker](https://github.com/atatusoft-ltd/ppphp-language-server/issues). Include a small reproducible example, your operating system, the installed extension and compiler versions, and relevant output with private paths and source removed.

[Language documentation](https://github.com/atatusoft-ltd/ppphp-src/tree/main/docs) · [Source and contributing](https://github.com/atatusoft-ltd/ppphp-language-server) · [Changelog](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CHANGELOG.md) · [Report a security issue](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/SECURITY.md)

Licensed under the [Apache License](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/LICENSE).
