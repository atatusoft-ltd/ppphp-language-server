# Releasing

## Version policy

Language-server and editor releases use numeric quarterly CalVer. Read `VERSION` to identify the tooling release being prepared. Read `COMPILER_VERSION` for the compiler identity targeted by its compatibility metadata.

Tooling releases use `YYYY.Q.R`:

- `YYYY` is the four-digit release year.
- `Q` is the calendar quarter (`1` through `4`).
- `R` starts at `1` for a quarter's first release and increments for another release in that quarter.

Every package manifest's `version`, owned lockfile entry, and PhpStorm `pluginVersion` uses this numeric tooling version. The language server reports this identity in LSP initialization. RC and Development channel markers belong to the compiler only; they do not become extension/plugin version suffixes or Marketplace pre-release flags.

The existing `ppphpToolchainVersion` fields carry compiler compatibility identity and must match `COMPILER_VERSION`, which accepts the compiler's `YYYY.Q.R`, `YYYY.Q.R-rc-N`, and `dev-YYYY.Q.R` forms. These fields are not package release versions and are not a substitute for protocol capability checks.

This separation is intentional: the VS Code Marketplace requires numeric `major.minor.patch` extension versions, and a compiler candidate does not make the editor integration a candidate. See [Microsoft's publishing requirements](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#pre-release-extensions). Do not derive tooling versions by stripping a compiler suffix at build time: multiple compiler candidates would collapse onto the same immutable Marketplace release. Increment `R` before publishing changed tooling; updating the compiler alone does not automatically publish or renumber plugins.

Run `php scripts/check_release_version.php` after either identity changes; it validates tooling and compiler metadata separately, including numeric Marketplace bounds. The `npm run check:version` alias remains available for npm workflows. Tooling release tags use the value of `VERSION` prefixed with `v`; they do not rename or promote compiler releases.

Do not insert the release value into evergreen documentation or product descriptions. Compatibility belongs in package constraints, editor engines, and plugin build metadata. Runtime prerequisites have one installation reference; other pages link to it. Dated release notes and changelogs carry release-specific facts. Follow the [public-copy policy](../CONTRIBUTING.md#public-facing-copy) for install commands and explicit release-candidate instructions.

## Release checklist

1. Confirm the compatible ++PHP compiler version and diagnostic protocol. Verify the intended release is actually installable from the canonical Composer package `atatusoft/ppphp` before publishing editor packages that direct users to it. For a release candidate, include its exact compiler installation command in that release's notes and keep the editor READMEs' release-candidate links pointing to those instructions. Clear publication-blocker notes in the changelog and both editor setup guides only after verifying availability; candidate publication alone does not make the unversioned stable install command usable. Preserve historical instructions for releases under the former package name.
2. Update `VERSION`, package and editor version fields, the lockfile, and dated release notes/changelogs for a tooling release. Update `COMPILER_VERSION` and its `ppphpToolchainVersion` fields only when the targeted compiler changes. Do not rewrite evergreen copy.
3. Run `npm install --package-lock-only --ignore-scripts` to refresh the lockfile.
4. Run `npm run check`.
5. Run `php scripts/build.php vscode`, then smoke-test highlighting and language-server startup.
6. Run `php scripts/build.php phpstorm`, then run the complete structure validation, configuration validation, and Plugin Verifier suite.
7. Install both local packages and smoke-test `.ppphp` recognition, highlighting, diagnostics, completion, hover, and symbols.
8. Inspect the built VSIX and plugin ZIP, not only source manifests. Confirm that their release versions match `VERSION`, the VSIX publisher is `AtatusoftLtd`, and the VSIX does not acquire a pre-release flag from compiler compatibility metadata.
9. Run `php scripts/build.php zed`, install `editors/zed` as a Zed dev extension, and complete its [smoke checklist](../editors/zed/README.md#verification-and-limits). The Zed manifest, Rust package, and Cargo lockfile must match `VERSION`. The registry supports this monorepo through `path = "editors/zed"`; follow the distribution steps below.
10. Create a `v*` tag only after all checks pass and every tooling manifest and artifact reports the version in `VERSION`.

Publishing a Marketplace extension, JetBrains plugin, tag, GitHub release, or binary remains an explicit maintainer action.

For JetBrains publication, complete the [listing and media checklist](jetbrains-marketplace.md). A README update alone does not prepare the Marketplace gallery or configure its contact fields.

## PhpStorm Windows and WSL smoke test

Install the built plugin in a supported PhpStorm version on Windows and open the same ++PHP project through WSL. Confirm that:

- no plugin exception or `ProviderMismatchException` is reported;
- indexing completes and Composer support remains usable;
- compiler cache, metadata, stale output, and copied PHP outputs stay excluded, while compiled ++PHP declarations and source/dependency roots remain indexed;
- native PHP references resolve compiled ++PHP declarations without duplicate copied-PHP declarations;
- changing `ppphp.json` refreshes exclusions without repeated failures;
- unsaved edits and saves both refresh diagnostics;
- definition, completion, hover, symbols, and class-family rename work; and
- restarting PhpStorm leaves startup and indexing clean.

## Zed distribution

A registry installation must work without a checkout, custom server path, Rust, or npm. The grammar supplies type/generic colors independently of the server. The Rust adapter uses Zed's Node.js runtime and downloads the matching standalone server on the project host.

1. Build `php scripts/build.php server-release`. It produces `build/server-release/ppphp-language-server-<VERSION>.cjs`, `SHA256SUMS`, and `LICENSE`. The bundle includes its npm runtime dependencies. CI retains these files and the Wasm as `ppphp-zed-release-inputs`.
2. Build and validate the extension on Windows and Linux. The native Windows targets must also work from a long/UNC checkout. Commit grammar changes first, then pin the same grammar commit in `extension.toml` and the Rust test dependency.
3. After approval to publish, create the tag matching `VERSION` and publish a GitHub release on this repository. Upload the exact versioned server filename, checksum, and license. Do not replace a published asset with changed bytes; increment the tooling release instead.
4. Verify the public download from a clean host before submitting the extension to the registry. The adapter's URL is `https://github.com/atatusoft-ltd/ppphp-language-server/releases/download/v<VERSION>/ppphp-language-server-<VERSION>.cjs`. A missing asset is a publication blocker.
5. Submit a PR to [Zed's extension registry](https://github.com/zed-industries/extensions) adding this repository as the `extensions/ppphp-lsp` submodule at the validated release commit, with the following entry. Replace the version placeholder with `VERSION`:

```toml
[ppphp-lsp]
submodule = "extensions/ppphp-lsp"
path = "editors/zed"
version = "<VERSION>"
```

The registry builds and distributes the extension Wasm and grammar. A separate extension repository is unnecessary; the registry already supports monorepo `path` entries. End users install **++PHP** in Zed. Updates move the registry submodule/version and publish a new matching server asset; cached older versions remain available offline.

Complete the [clean-profile smoke checklist](../editors/zed/README.md#verification-and-limits) against the published asset before announcing availability. CI artifacts and a successful development install do not by themselves constitute a registry release.
