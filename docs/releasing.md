# Releasing

## Version policy

Language-server and editor releases track the compatible ++PHP toolchain using quarterly CalVer. Read `VERSION` to identify the release being prepared.

The canonical, user-facing forms are `YYYY.Q.R`, `YYYY.Q.R-rc-N`, and `dev-YYYY.Q.R`:

- `YYYY` is the four-digit release year.
- `Q` is the calendar quarter (`1` through `4`).
- `R` starts at `1` for a quarter's first release and increments for another release in that quarter.
- `N` starts at `1` for a release core's first candidate and increments for subsequent candidates.
- Development, Release Candidate, and Stable are separate channels; Stable has no suffix.

Every package manifest, editor manifest, lockfile entry, and `ppphpToolchainVersion` field uses this exact version. There is no separate padded or ecosystem-specific form.

`VERSION` is the repository source of truth. Run `php scripts/check_release_version.php` after any version change; it rejects drift between `VERSION`, npm manifests and lockfile, and editor metadata. The `npm run check:version` alias remains available for npm workflows. Release tags use the value of `VERSION` prefixed with `v`.

Do not insert the release value into evergreen documentation or product descriptions. Compatibility belongs in package constraints, editor engines, and plugin build metadata. Runtime prerequisites have one installation reference; other pages link to it. Dated release notes and changelogs carry release-specific facts. Follow the [public-copy policy](../CONTRIBUTING.md#public-facing-copy) for install commands and explicit release-candidate instructions.

## Release checklist

1. Confirm the compatible ++PHP compiler version and diagnostic protocol.
2. Update `VERSION`, package and editor version fields, the lockfile, and dated release notes/changelogs. Change compatibility constraints only when requirements actually change; do not rewrite evergreen copy.
3. Run `npm install --package-lock-only --ignore-scripts` to refresh the lockfile.
4. Run `npm run check`.
5. Run `php scripts/build.php vscode`, then smoke-test highlighting and language-server startup.
6. Run `php scripts/build.php phpstorm`, then run the complete structure validation, configuration validation, and Plugin Verifier suite.
7. Install both local packages and smoke-test `.ppphp` recognition, highlighting, diagnostics, completion, hover, and symbols.
8. Create a `v*` tag only after every manifest and artifact reports the same version.

Publishing a Marketplace extension, JetBrains plugin, tag, GitHub release, or binary remains an explicit maintainer action.
