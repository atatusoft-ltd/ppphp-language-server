# Contributing

## Development setup

Install Node.js 22 and Java 25, then run:

```shell
npm ci
npm run check
```

Use the checked-in Gradle wrapper for PhpStorm work:

```shell
./editors/phpstorm/gradlew -p editors/phpstorm check buildPlugin verifyPluginStructure verifyPluginProjectConfiguration verifyPlugin
```

## Change flow

After the maintainer creates `develop`, branch from it for normal work and target it with pull requests. Keep `main` release-ready and use pull requests to merge `develop` into `main` for releases. Until then, keep local changes small and reviewable on `main`.

Each pull request should explain the user-visible behavior, list verification performed, include tests for protocol or parser logic, and update the changelog when appropriate. Avoid combining unrelated dependency, formatting, and feature changes.

## Language resources

`res/textmate/ppphp` is canonical. Do not edit generated grammar copies under `editors/vscode` directly. Run:

```shell
npm run sync:resources
```

## Adding LSP capabilities

Capabilities are a compatibility promise. Add one only when both editor clients can use it safely and automated tests cover its important failure modes. Cross-file rename, references, and refactoring must use compiler-provided symbol identity rather than textual matching.

## Commits

Prefer focused commits with imperative subjects. Never commit dependency directories, editor sandboxes, packaged extensions, build outputs, credentials, or local machine paths.
