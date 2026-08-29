# Releasing

## Version policy

Language-server and editor releases track the compatible ++PHP toolchain using the same CalVer system as Doria. The current target is `2026.3.1`.

The canonical, user-facing form is `YYYY.Q.patch[-channel]`:

- `YYYY` is the four-digit release year.
- `Q` is the calendar quarter (`1` through `4`).
- `patch` starts at `1` for a quarter's first release and increments for another release in that quarter.
- Development releases carry a channel such as `-canary`; omit it for a stable release.

Every package manifest, editor manifest, lockfile entry, and `ppphpToolchainVersion` field uses this exact version. There is no separate padded or ecosystem-specific form.

`VERSION` is the repository source of truth. Run `npm run check:version` after any version change; it rejects drift between `VERSION`, npm manifests and lockfile, editor metadata, and documentation. Release tags use the version prefixed with `v`, such as `v2026.3.1`.

## Release checklist

1. Confirm the compatible ++PHP compiler version and diagnostic protocol.
2. Update `VERSION`, every package and editor manifest, the lockfile, all changelogs, and compatibility notes to the same value.
3. Run `npm install --package-lock-only --ignore-scripts` to refresh the lockfile.
4. Run `npm run check`.
5. Build the VS Code VSIX and smoke-test highlighting and language-server startup.
6. Run the complete PhpStorm check, plugin build, structure validation, configuration validation, and Plugin Verifier suite.
7. Install both local packages and smoke-test `.ppp` recognition, highlighting, diagnostics, completion, hover, and symbols.
8. Create a `v*` tag only after every manifest and artifact reports the same version.

Publishing a Marketplace extension, JetBrains plugin, tag, GitHub release, or binary remains an explicit maintainer action.
