# PhpStorm troubleshooting

Start with the [plugin setup and common checks](../editors/phpstorm/README.md#troubleshooting). For detailed errors, open **Help → Show Log in Finder/Explorer**. Remove private paths and source before sharing logs.

## Selecting Node.js explicitly

The plugin uses the project's local Node.js runtime configured under **Settings → Languages & Frameworks → JavaScript Runtime**. This also works when a desktop-launched IDE does not inherit the path used by nvm, fnm, or another shell version manager.

For an explicit override, set `PPPHP_NODE_PATH` to the absolute Node.js executable path in the IDE's environment, or use **Help → Edit Custom VM Options** to add:

```text
-Dppphp.language.server.node.path=/absolute/path/to/node
```

Restart PhpStorm after changing its environment or VM options. Configure a local executable accessible to the IDE process; a path inside another environment is not automatically translated.

## Blank code-style previews

An `IElementType.TooManyElementTypesException` (shown in logs as `IElementType$TooManyElementTypesException`) means the IDE-wide element-type registry is exhausted. It can break indexing and newly created previews across languages.

Fully restart PhpStorm, not just the ++PHP language server. If it recurs, inspect the first registry-exhaustion entry for the language registering excessive element types and report it to that plugin's maintainer. Reinstalling ++PHP or changing indentation preferences does not repair an exhausted registry in a running IDE.

## Mixed-project indexing

Build after adding or changing ++PHP declarations consumed by ordinary PHP. The plugin reads only compiler-manifest entries marked as PHP compiled from `.ppphp`; it does not expose the entire output directory. Missing, unsupported, malformed, or unsafe manifests leave generated declarations out of the PHP index.

Check `ppphp.json`, the configured output directory, and the build result before changing IDE include paths. Compiler cache and output paths must remain inside the project and must not overlap protected source or stub roots. The plugin watches project/output roots and refreshes the generated-declaration library when the manifest changes.
