# ++PHP

[![Checks](https://img.shields.io/github/actions/workflow/status/atatusoft-ltd/ppphp-language-server/ci.yml?branch=main&label=checks)](https://github.com/atatusoft-ltd/ppphp-language-server/actions/workflows/ci.yml?query=branch%3Amain)
[![License: Apache](https://img.shields.io/badge/license-Apache-blue)](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/LICENSE)

Support for the [++PHP programming language](https://ppphplang.org). Edit `.ppphp` source with code completion, error checking, navigation, and refactoring. ++PHP extends PHP and compiles to PHP.

## Features

- Syntax highlighting using the IDE's PHP color scheme, with compiler-backed semantic highlighting.
- Type completion from project code, Composer dependencies, stubs, and PHP built-ins, with automatic imports that respect aliases and code style.
- Live compiler diagnostics for unsaved edits.
- Go to Declaration and rename for classes, interfaces, traits, and enums.
- **Use import**, **Import class**, and **Create class** intention actions.
- File and declaration templates with namespace and parent-type suggestions.
- Code formatting, indentation, and PHPDoc comment scaffolding.
- Native PHP navigation to declarations compiled from ++PHP in mixed projects.

## Getting started

The language server is bundled. Configure a local Node.js runtime, install the ++PHP compiler in your project, and open a `.ppphp` file. Follow the [installation and setup guide](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/phpstorm.md#installation-and-setup) for the steps in PhpStorm, the currently tested host.

Formatting does not yet have complete PHP parity, and PHPDoc scaffolding does not generate signature-derived tags. See [editing support and limitations](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/phpstorm.md#everyday-editing).

[User guide](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/docs/phpstorm.md) · [Report an issue](https://github.com/atatusoft-ltd/ppphp-language-server/issues) · [Changelog](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CHANGELOG.md) · [Contributing](https://github.com/atatusoft-ltd/ppphp-language-server/blob/main/CONTRIBUTING.md)
