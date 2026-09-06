# Contributing

## Development setup

Install the tools described in the [requirements](README.md#requirements), then run:

```shell
npm ci
npm run check
php scripts/build.php help
```

Use the PHP build entrypoint for installable editor artifacts:

```shell
php scripts/build.php vscode
php scripts/build.php phpstorm
php scripts/build.php editors
```

These PHP build targets verify all npm workspaces and automatically run the locked
root `npm ci` when dependencies are missing or belong to an incompatible host
platform. This makes the same commands usable from native Windows and WSL without
workspace-specific installation steps.

Use the checked-in Gradle wrapper directly when running the complete PhpStorm verification suite:

```shell
./editors/phpstorm/gradlew -p editors/phpstorm check buildPlugin verifyPluginStructure verifyPluginProjectConfiguration verifyPlugin
```

## Change flow

After the maintainer creates `develop`, branch from it for normal work and target it with pull requests. Keep `main` release-ready and use pull requests to merge `develop` into `main` for releases. Until then, keep local changes small and reviewable on `main`.

Each pull request should explain the user-visible behavior, list verification performed, include tests for protocol or parser logic, and update the changelog when appropriate. Avoid combining unrelated dependency, formatting, and feature changes.

## Language resources

`res/textmate/ppphp` is canonical. Do not edit generated grammar copies under `editors/vscode` directly. Run:

```shell
php scripts/sync_language_resources.php
```

## Public-facing copy

Product descriptions, headings, introductions, examples, component labels, and editor READMEs describe ++PHP without release numbers or channel labels. Keep compatibility in machine-readable manifests and installation prerequisites; link to those sources instead of duplicating their constraints. Exact releases belong in dated release notes and changelogs, not evergreen product copy.

The default public install command is `composer require --dev atatusoft-ltd/ppphp-src`. Pinned prerelease commands belong only under an explicit **Installing a release candidate** section or in that release's notes. A release bump must not require rewriting product descriptions or READMEs. The release consistency check validates metadata, not marketing prose.

## Adding LSP capabilities

Capabilities are a compatibility promise. Add one only when both editor clients can use it safely and automated tests cover its important failure modes. Cross-file rename, references, and refactoring must use compiler-provided symbol identity rather than textual matching.

## Commits

Prefer focused commits with imperative subjects. Never commit dependency directories, editor sandboxes, packaged extensions, build outputs, credentials, or local machine paths.
