# Using ++PHP in PhpStorm

For a feature overview, see the [++PHP plugin](../editors/phpstorm/README.md). This guide covers setup and everyday use in PhpStorm, the currently tested host.

## Installation and setup

New compiler installations are blocked until the renamed Composer package is published. The new-install command below is for use after publication only; check the [release status and compatible compiler instructions](../CHANGELOG.md#installing-a-release-candidate) before continuing. Existing checkouts can restore their locked dependencies now with `composer install` instead.

1. Install the plugin ZIP through **Settings → Plugins → gear menu → Install Plugin from Disk…**, then restart PhpStorm. If you are building the plugin yourself, follow the [contributor build instructions](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CONTRIBUTING.md#development-setup).
2. Configure a local Node.js runtime under **Settings → Languages & Frameworks → JavaScript Runtime**. Its supported range is recorded in the [language-server manifest](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/packages/language-server/package.json); IDE compatibility is declared by the plugin package.
3. Open your project folder. For a new installation, **only after a compatible stable compiler is published**, run in its terminal:

   ```shell
   composer require --dev atatusoft/ppphp
   ```

4. For a new ++PHP project, create its configuration:

   ```shell
   vendor/bin/ppphp init
   ```

5. Open a `.ppphp` file. The plugin starts its language server automatically.

For PHP and Composer prerequisites and the complete build workflow, see the [getting-started guide](https://github.com/atatusoft-ltd/ppphp-src/blob/main/docs/getting-started.md). For an existing checkout, run `composer install` to restore its dependencies instead of adding the compiler again.

Before installing or migrating the Composer package, check the [compiler installation guide](compiler-installation.md) for publication prerequisites and migration steps.

The compiler is discovered at `vendor/bin/ppphp` in your project, then on `PATH`. Open the folder containing `ppphp.json` so project-wide operations use the correct source boundaries.

### Installing a release candidate

Composer selects stable packages by default. To use a compiler candidate, check the installed plugin's version in **Settings → Plugins** and consult its [compiler compatibility and candidate installation notes](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CHANGELOG.md#installing-a-release-candidate). Choose that release entry, not simply the newest compiler candidate. Compiler candidates do not change the plugin's release channel.

## Everyday editing

### Imports and refactoring

Use the intention menu (**Alt+Enter** in the default keymap) on a fully qualified type for **Use import**. On an unresolved short type name, choose **Import class** and select the intended namespace from the **Class to import** popup, or choose **Create class** to open a prefilled declaration dialog.

Use **Refactor → Rename** on a class, interface, trait, or enum to update its project references. Rename requires `ppphp.json`; unsafe name collisions and edits outside the project are refused. Function, method, property, and variable rename are not currently provided.

### Creating declarations

In the Project view, choose **New → ++PHP File** or **New → ++PHP Class**. The class dialog also creates interfaces, traits, and enums. It suggests the namespace from your project's Composer mappings and offers known classes or interfaces for `extends` and `implements`, excluding final classes from inheritance suggestions.

The dialog follows your PHP file-header template and ++PHP code-style settings. You can change the filename independently of the declaration name.

### Code style and documentation comments

Configure **Settings → Editor → Code Style → ++PHP**, including import sorting under **Code Conversion**. These settings are independent of the ordinary PHP scheme. **Reformat Code** and indentation on Enter use the ++PHP formatter.

Typing `/**` and pressing Enter creates a closed, indented PHPDoc block; Enter inside the block continues its `*` prefix. This scaffolds the comment but does not generate signature-derived `@param` or `@return` tags.

The formatter does not yet have complete PHP parity. Known gaps include switch/case indentation, casts, some ternary/operator contexts, and mixed PHP/HTML layout. See the [formatting coverage notes](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/architecture.md#editor-adapters) for details.

## Working with PHP and ++PHP together

Keep your existing PHP tooling for `.php` files. To let native PHP code resolve ++PHP-authored declarations, build the project after adding or changing declarations that PHP consumes:

```shell
vendor/bin/ppphp build
```

The plugin uses the compiler's build manifest to expose generated declarations to PhpStorm's PHP index. Copied PHP files, stale output, and compiler metadata stay excluded to avoid duplicate declarations. Hand-written shadow stubs are not needed for this integration; without a valid build manifest, generated declarations are not exposed.

Live diagnostics cover the compiler's own findings in unsaved buffers. Run `vendor/bin/ppphp check` for the complete saved-project check, including supplemental PHPStan analysis when configured. The plugin does not build your application automatically, and native PHP inspections do not analyze `.ppphp` source.

## Troubleshooting

- **No highlighting?** Check that the filename ends in `.ppphp` and is associated with **++PHP**, not PHP or plain text. Restart PhpStorm after installing or updating the plugin.
- **Language server unavailable?** Check the configured local Node.js runtime. Desktop-launched IDEs may not inherit your shell's version-manager environment.
- **Compiler unavailable?** Run `vendor/bin/ppphp --version` in the project terminal and check the PHP executable visible to the IDE. `PPPHP_COMPILER_PATH` can select a compiler, and `PPPHP_PHP_PATH` can select PHP; use absolute paths. On Windows, PHP must be available as `php.exe` unless explicitly configured.
- **Unsaved diagnostics unavailable?** Check [compiler availability and compatibility](../CHANGELOG.md#installing-a-release-candidate) first. Once the intended release is published, update an existing `atatusoft/ppphp` requirement with `composer update atatusoft/ppphp`. If the project still requires the former package name, follow the [migration steps](compiler-installation.md#migrating-from-the-former-package-name) instead. For a compiler candidate, follow the matching installation notes above.
- **Undefined types from PHP files?** Rebuild the project and check that its generated output and build manifest exist. Do not add the entire build directory to the PHP include path as a workaround.
- **PHPStan says “Cannot run program”?** Check PhpStorm's PHP interpreter and PHPStan executable settings. This is a separate quality-tool launch failure, not evidence that ++PHP live diagnostics ran.
- **Blank code-style previews or startup errors?** See the [PhpStorm troubleshooting guide](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/phpstorm-troubleshooting.md).

## Feedback and support

Report bugs or request features in the [issue tracker](https://github.com/atatusoft-ltd/ppphp-language-server/issues). Include a small reproducible example, your operating system, the installed IDE, plugin and compiler versions, and relevant logs with private paths and source removed. Use **Help → Show Log in Finder/Explorer** to locate the IDE log.

[Language documentation](https://github.com/atatusoft-ltd/ppphp-src/tree/main/docs) · [Source and contributing](https://github.com/atatusoft-ltd/ppphp-language-server) · [Changelog](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CHANGELOG.md) · [Report a security issue](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/SECURITY.md)

Licensed under the [Apache License](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/LICENSE).
