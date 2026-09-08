# Installing the compiler for editor tooling

Both editors use the same project-local ++PHP compiler. PHP and Composer prerequisites live in the compiler's [getting-started guide](https://github.com/atatusoft-ltd/ppphp-src/blob/main/docs/getting-started.md#requirements).

The canonical Composer package is `atatusoft/ppphp`. Check the [release notes for publication status and compiler compatibility](../CHANGELOG.md#installing-a-release-candidate) before installing or migrating: a package rename does not itself publish a release. Do not remove an existing requirement until the intended replacement release is available.

## New projects and updates

To install the stable compiler once available:

```shell
composer require --dev atatusoft/ppphp
```

To update within your project's existing constraint:

```shell
composer update atatusoft/ppphp
```

For an existing checkout, use `composer install` to restore its locked dependencies. Do not change its package name or stability policy just to open it in an editor. If a compatible stable release is unavailable, consult the explicit **Installing a release candidate** section in the matching tooling release notes; do not lower the whole project's `minimum-stability`.

## Migrating from the former package name

For projects with `atatusoft-ltd/ppphp-src` in `require-dev`, first confirm the replacement release is available, then run:

```shell
composer remove --dev --no-update atatusoft-ltd/ppphp-src
composer require --dev atatusoft/ppphp
```

If the old package is in production `require`, omit `--dev` from both commands so migration preserves that dependency scope. If you intentionally need a compiler candidate, replace the second command with the exact candidate command from the matching release notes, retaining the appropriate scope.

Review and commit the resulting `composer.json` and `composer.lock` together. If resolution fails, do not leave the removal as a finished migration: restore your prior requirement and lockfile from your own pre-migration changes, or resolve the reported dependency conflict before committing.

Historical releases published under the former name keep their original installation instructions. The [compiler GitHub repository](https://github.com/atatusoft-ltd/ppphp-src), PHP namespace, CLI name, and `.ppphp` extension have not changed.

## Compiler discovery after migration

Composer still exposes `vendor/bin/ppphp` (`vendor/bin/ppphp.bat` on Windows). Both editors discover this project-local proxy before falling back to `ppphp` on `PATH`; they do not depend on the Composer package's vendor directory name.

An explicit `ppphp.compiler.path` setting in VS Code or `PPPHP_COMPILER_PATH` environment override takes precedence. If an override points inside the former vendor package directory, update it to an absolute path to the project's `vendor/bin/ppphp` proxy instead. On Windows, use its `.bat` path; the language server runs the accompanying PHP proxy without a shell. Keep any `PPPHP_PHP_PATH` runtime override unchanged unless your PHP installation also moved.

After Composer finishes, check `vendor/bin/ppphp --version` in the project terminal and restart the editor's language server or reload the IDE to discard any process from the previous installation.
