import { CodeActionKind, type CodeAction, type Range } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { resolveCompilerSymbolAt } from "./compiler-definition.js";
import type { CompilerSettings } from "./compiler-diagnostics.js";
import type { ImportSorting } from "./server-settings.js";
import type { TypeCatalogEntry } from "./type-catalog.js";
import { typeImportCodeActionsAt, unresolvedTypeAt } from "./type-import.js";

export interface TypeActionCapabilities {
  groupedImports?: boolean;
  classCreation?: boolean;
}

/** Candidate discovery is shared; scoped symbol resolution remains compiler-owned. */
export async function typeCodeActionsAt(
  document: TextDocument,
  range: Range,
  catalog: readonly TypeCatalogEntry[],
  filePath: string,
  workspaceRoot: string,
  settings: CompilerSettings & { importSorting: ImportSorting },
  capabilities: TypeActionCapabilities = {},
): Promise<CodeAction[]> {
  const unresolved = unresolvedTypeAt(document, range, catalog);
  const imports = typeImportCodeActionsAt(document, range, catalog, settings.importSorting);
  if (!unresolved) return imports;
  // A generic parameter or another scoped symbol is not an unresolved class.
  const resolution = await resolveCompilerSymbolAt(
    document,
    range.start,
    filePath,
    workspaceRoot,
    settings,
  );
  if (resolution.symbol || resolution.unavailableReason) return [];
  const actions: CodeAction[] =
    capabilities.groupedImports && imports.length > 0
      ? [
          {
            title: "Import class",
            kind: CodeActionKind.RefactorRewrite,
            edit: imports[0]!.edit,
            data: { ppphp: { kind: "importChoices", version: document.version, choices: imports } },
          },
        ]
      : imports;
  if (capabilities.classCreation)
    actions.push({
      title: "Create class",
      kind: CodeActionKind.RefactorRewrite,
      command: { title: "Create class", command: "ppphp.createClass" },
      data: { ppphp: { kind: "createClass", version: document.version, ...unresolved } },
    });
  return actions;
}
