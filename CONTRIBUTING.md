# Contributing

## Development setup

Keep TypeScript and typescript-eslint within the linter's published peer dependency range. Upgrade the compiler only when the lint toolchain supports it; do not bypass peer checks with `--force` or `--legacy-peer-deps`. Consult the [upstream compatibility policy](https://typescript-eslint.io/users/dependency-versions/) and the dependency versions recorded in the package manifest.

Dependabot groups routine minor/patch npm updates, while unrelated major updates remain separate PRs so an incompatible major cannot block compatible maintenance updates. The Vitest runner and its coverage adapters are one group even for major updates because they require matching peer versions. Keep the development Node requirement in the root package manifest compatible with both the test and lint toolchains; `.nvmrc` selects the development runtime line. Validate each proposed dependency set with a clean `npm ci` and `npm run check`, including both editor builds in CI.

Install the tools described in the [requirements](README.md#requirements), with PHP's Phar and SimpleXML extensions enabled for repository tests and VSIX artifact validation. These are build/test dependencies, not additional requirements imposed by the editor plugin. Then run:

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

Use `develop` for normal work and pull requests into `main`, keeping `main` release-ready. Do not create remote feature branches. Existing dependency-update PR branches may be updated in place to resolve their checks and reviews. Temporary working branches stay local. After merging, synchronize `develop` with `main` without rewriting shared history.

Each pull request should explain the user-visible behavior, list verification performed, include tests for protocol or parser logic, and update the changelog when appropriate. Avoid combining unrelated dependency, formatting, and feature changes.

## Language resources

`res/textmate/ppphp` is canonical. Do not edit generated grammar copies under `editors/vscode` directly. Run:

```shell
php scripts/sync_language_resources.php
```

## Public-facing copy

Product descriptions, headings, introductions, examples, component labels, and editor READMEs describe ++PHP without release numbers or channel labels. Keep compatibility in machine-readable manifests and installation prerequisites; link to those sources instead of duplicating their constraints. Exact releases belong in dated release notes and changelogs, not evergreen product copy.

The default public install command is `composer require --dev atatusoft-ltd/ppphp-src`. Pinned prerelease commands belong only under an explicit **Installing a release candidate** section or in that release's notes. A release bump must not require rewriting product descriptions or READMEs. The release consistency check validates metadata, not marketing prose.

Adapt copy to its host. The JetBrains plugin is named **++PHP**; supported IDEs belong in compatibility metadata, not the product title. Its Marketplace overview comes from the HTML plugin description, not the VS Code README. Keep setup details in the user guide and maintain gallery/contact fields separately; see the [JetBrains listing handoff](docs/jetbrains-marketplace.md).

## Adding LSP capabilities

Capabilities are a compatibility promise. Add one only when both editor clients can use it safely and automated tests cover its important failure modes. Cross-file rename, references, and refactoring must use compiler-provided symbol identity rather than textual matching.

## Commits

Prefer focused commits with imperative subjects. Never commit dependency directories, editor sandboxes, packaged extensions, build outputs, credentials, or local machine paths.
