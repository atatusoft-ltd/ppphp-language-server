# Releasing

## Version policy

Language-server and editor releases track the compatible ++PHP toolchain using the same CalVer system as Doria. The current target is `2026.03.1-canary`.

The canonical, user-facing form is `YYYY.QQ.patch[-channel]`:

- `YYYY` is the four-digit release year.
- `QQ` is the zero-padded calendar quarter (`01` through `04`).
- `patch` starts at `1` for a quarter's first release and increments for another release in that quarter.
- Development releases carry a channel such as `-canary`; omit it for a stable release.

Package ecosystems that require SemVer-compatible numeric components use the equivalent unpadded quarter. For example, the canonical `2026.03.1-canary` release is encoded as `2026.3.1-canary` in npm and the VS Code manifest. Metadata that supports arbitrary version text also retains `ppphpToolchainVersion: 2026.03.1-canary`.

`VERSION` is the canonical repository version. Run `npm run check:version` after any version change; it rejects drift between `VERSION`, npm manifests and lockfile, the LSP-reported version, editor metadata, and documentation. Release tags use the canonical form prefixed with `v`, such as `v2026.03.1-canary`.

## Release checklist

1. Confirm the compatible ++PHP compiler version and diagnostic protocol.
2. Update `VERSION`, all changelogs, and compatibility notes.
3. Update the SemVer-encoded npm/VS Code versions and canonical `ppphpToolchainVersion` metadata.
4. Update the PhpStorm plugin version using the canonical form.
5. Run `npm install --package-lock-only --ignore-scripts` to refresh the lockfile.
6. Run `npm run check`.
7. Build the VS Code VSIX and smoke-test highlighting and language-server startup.
8. Run the complete PhpStorm check, plugin build, structure validation, configuration validation, and Plugin Verifier suite.
9. Install both local packages and smoke-test `.ppp` recognition, highlighting, diagnostics, completion, hover, and symbols.
10. Create a `v*` tag only after every manifest and artifact reports the compatible version.

Publishing a Marketplace extension, JetBrains plugin, tag, GitHub release, or binary remains an explicit maintainer action.
