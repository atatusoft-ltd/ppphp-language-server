# Contributing

## Development setup

Install PHP 8.4, Node.js 22, and Java 21 or newer, then run:

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

## Adding LSP capabilities

Capabilities are a compatibility promise. Add one only when both editor clients can use it safely and automated tests cover its important failure modes. Cross-file rename, references, and refactoring must use compiler-provided symbol identity rather than textual matching.

## Commits

Prefer focused commits with imperative subjects. Never commit dependency directories, editor sandboxes, packaged extensions, build outputs, credentials, or local machine paths.
