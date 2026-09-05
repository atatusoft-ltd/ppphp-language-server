import path from "node:path";
import {
  createConnection,
  DidChangeConfigurationNotification,
  ErrorCodes,
  ProposedFeatures,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
  type InitializeParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import packageMetadata from "../package.json";
import { findDefinitionAt } from "./compiler-definition.js";
import { checkDocument, filePathFromUri } from "./compiler-diagnostics.js";
import { DiagnosticScheduler } from "./diagnostic-scheduler.js";
import { prepareTypeRenameAt, renameTypeAt, type RenameClientSupport } from "./compiler-rename.js";
import { classifySemanticTokens } from "./compiler-semantic-tokens.js";
import {
  handleComposerNamespaceCommand,
  INFER_COMPOSER_NAMESPACE_COMMAND,
} from "./composer-namespace.js";
import { COMPLETIONS, documentSymbols, hoverAt } from "./language-features.js";
import { SEMANTIC_TOKEN_LEGEND, semanticTokens } from "./semantic-tokens.js";
import {
  compilerSettingsFromConfiguration,
  DEFAULT_SETTINGS,
  type ServerSettings,
} from "./server-settings.js";
import {
  getTypeCatalog,
  invalidateTypeCatalog,
  updateTypeCatalogDocument,
} from "./type-catalog.js";
import { typeCompletionsAt } from "./type-completion.js";
import { typeCodeActionsAt, type TypeActionCapabilities } from "./type-actions.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let supportsConfiguration = false;
let workspaceFolders: string[] = [];
let typeActionCapabilities: TypeActionCapabilities = {};
let renameClientSupport: RenameClientSupport = {
  documentChanges: false,
  renameFileOperations: false,
};
const diagnosticScheduler = new DiagnosticScheduler(validateOpenDocuments, (error) => {
  reportUnavailable(error instanceof Error ? error.message : String(error));
});
let reportedCoverageNote: string | undefined;
let unavailableReason: string | undefined;

connection.onInitialize((params: InitializeParams) => {
  const options = params.initializationOptions as { typeActions?: TypeActionCapabilities } | null;
  typeActionCapabilities = {
    groupedImports: options?.typeActions?.groupedImports === true,
    classCreation: options?.typeActions?.classCreation === true,
  };
  supportsConfiguration = Boolean(params.capabilities.workspace?.configuration);
  const workspaceEdit = params.capabilities.workspace?.workspaceEdit;
  renameClientSupport = {
    documentChanges: workspaceEdit?.documentChanges === true,
    renameFileOperations:
      workspaceEdit?.documentChanges === true &&
      workspaceEdit.resourceOperations?.includes("rename") === true,
  };
  workspaceFolders = (params.workspaceFolders ?? [])
    .map((folder) => filePathFromUri(folder.uri))
    .filter((folder): folder is string => folder !== null);

  if (workspaceFolders.length === 0 && params.rootUri) {
    const root = filePathFromUri(params.rootUri);
    if (root) workspaceFolders = [root];
  }

  return {
    serverInfo: {
      name: "++PHP Language Server",
      version: packageMetadata.ppphpToolchainVersion,
    },
    capabilities: {
      codeActionProvider: true,
      completionProvider: { triggerCharacters: ["<", "\\", "$", ":"] },
      definitionProvider: true,
      documentSymbolProvider: true,
      executeCommandProvider: { commands: [INFER_COMPOSER_NAMESPACE_COMMAND] },
      hoverProvider: true,
      renameProvider: { prepareProvider: true },
      semanticTokensProvider: {
        legend: SEMANTIC_TOKEN_LEGEND,
        full: true,
      },
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
    },
  };
});

connection.onInitialized(() => {
  if (supportsConfiguration) {
    void connection.client.register(DidChangeConfigurationNotification.type);
  }
  for (const workspaceRoot of workspaceFolders) {
    void getTypeCatalog(workspaceRoot).catch(() => undefined);
  }
});

connection.onDidChangeConfiguration(() => {
  invalidateTypeCatalog();
  diagnosticScheduler.schedule(0);
});
connection.onDidChangeWatchedFiles(() => {
  invalidateTypeCatalog();
  diagnosticScheduler.schedule();
});
connection.onShutdown(() => diagnosticScheduler.dispose());

connection.onCompletion(async ({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  const filePath = filePathFromUri(textDocument.uri);
  if (!document || !filePath) return [...COMPLETIONS];

  const workspaceRoot = findWorkspaceRoot(filePath);
  const catalog = await getTypeCatalog(workspaceRoot, documents.all());
  const settings = await getSettings(document.uri);
  const types = typeCompletionsAt(document, position, catalog, settings.importSorting);
  return types.length > 0 ? [...types, ...COMPLETIONS] : [...COMPLETIONS];
});
connection.onCodeAction(async ({ textDocument, range }) => {
  const current = documents.get(textDocument.uri);
  const document =
    current &&
    TextDocument.create(current.uri, current.languageId, current.version, current.getText());
  const filePath = filePathFromUri(textDocument.uri);
  if (!document || !filePath || path.extname(filePath).toLowerCase() !== ".ppphp") return [];

  const workspaceRoot = findWorkspaceRoot(filePath);
  const catalog = await getTypeCatalog(workspaceRoot, documents.all());
  const settings = await getSettings(document.uri);
  const actions = await typeCodeActionsAt(
    document,
    range,
    catalog,
    filePath,
    workspaceRoot,
    settings,
    typeActionCapabilities,
  );
  return documents.get(document.uri)?.version === document.version ? actions : [];
});
connection.onExecuteCommand(({ command, arguments: arguments_ }) =>
  command === INFER_COMPOSER_NAMESPACE_COMMAND ? handleComposerNamespaceCommand(arguments_) : null,
);
connection.onHover(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  return document ? hoverAt(document, position) : null;
});
connection.onDocumentSymbol(({ textDocument }) => {
  const document = documents.get(textDocument.uri);
  return document ? documentSymbols(document) : [];
});
connection.onDefinition(async ({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  const filePath = filePathFromUri(textDocument.uri);

  if (!document || !filePath || path.extname(filePath).toLowerCase() !== ".ppphp") return null;

  const workspaceRoot = findWorkspaceRoot(filePath);
  const settings = await getSettings(document.uri);
  const result = await findDefinitionAt(document, position, filePath, workspaceRoot, settings);
  reportUnavailable(result.unavailableReason);

  return result.definition;
});
connection.onPrepareRename(async ({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  const filePath = filePathFromUri(textDocument.uri);
  if (!document || !filePath || path.extname(filePath).toLowerCase() !== ".ppphp") return null;

  const workspaceRoot = findWorkspaceRoot(filePath);
  const settings = await getSettings(document.uri);
  const result = await prepareTypeRenameAt(document, position, filePath, workspaceRoot, settings);

  reportUnavailable(result.unavailableReason);
  return result.prepare;
});
connection.onRenameRequest(async ({ textDocument, position, newName }) => {
  const document = documents.get(textDocument.uri);
  const filePath = filePathFromUri(textDocument.uri);
  if (!document || !filePath || path.extname(filePath).toLowerCase() !== ".ppphp") return null;

  const workspaceRoot = findWorkspaceRoot(filePath);
  const settings = await getSettings(document.uri);
  const result = await renameTypeAt(
    document,
    position,
    newName,
    filePath,
    workspaceRoot,
    settings,
    documents.all(),
    renameClientSupport,
  );

  reportUnavailable(result.unavailableReason);
  const reason = result.rejectionReason ?? result.unavailableReason;
  if (reason) throw new ResponseError(ErrorCodes.InvalidParams, reason);
  return result.edit;
});
connection.languages.semanticTokens.on(async ({ textDocument }) => {
  const document = documents.get(textDocument.uri);
  const filePath = filePathFromUri(textDocument.uri);

  if (!document || !filePath || path.extname(filePath).toLowerCase() !== ".ppphp") {
    return { data: [] };
  }

  const workspaceRoot = findWorkspaceRoot(filePath);
  const settings = await getSettings(document.uri);
  const result = await classifySemanticTokens(document, filePath, workspaceRoot, settings);

  reportUnavailable(result.unavailableReason);

  return semanticTokens(document, result.tokens);
});

// TextDocuments emits this for both initial open and every incremental buffer change.
documents.onDidChangeContent(() => {
  diagnosticScheduler.schedule();
});
documents.onDidSave(({ document }) => {
  const filePath = filePathFromUri(document.uri);
  if (filePath) {
    updateTypeCatalogDocument(findWorkspaceRoot(filePath), filePath, document.getText());
  }
  diagnosticScheduler.schedule(0);
});
documents.onDidClose(({ document }) => {
  diagnosticScheduler.schedule();
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

async function validateOpenDocuments(isCurrent: () => boolean): Promise<void> {
  const snapshot = documents
    .all()
    .map((document) =>
      TextDocument.create(document.uri, document.languageId, document.version, document.getText()),
    );
  for (const document of snapshot) {
    if (!isCurrent()) return;
    const filePath = filePathFromUri(document.uri);
    if (!filePath || path.extname(filePath).toLowerCase() !== ".ppphp") continue;
    const workspaceRoot = findWorkspaceRoot(filePath);
    const settings = await getSettings(document.uri);
    if (!isCurrent()) return;
    const overlays = snapshot.filter((other) => {
      const otherPath = filePathFromUri(other.uri);
      return (
        otherPath &&
        [".php", ".ppphp"].includes(path.extname(otherPath).toLowerCase()) &&
        findWorkspaceRoot(otherPath) === workspaceRoot
      );
    });
    const result = await checkDocument(document, filePath, workspaceRoot, settings, overlays);
    if (!isCurrent()) return;
    connection.sendDiagnostics({
      uri: document.uri,
      version: document.version,
      diagnostics: result.diagnostics,
    });
    reportUnavailable(result.unavailableReason);
    if (result.coverageNote && result.coverageNote !== reportedCoverageNote) {
      reportedCoverageNote = result.coverageNote;
      connection.console.warn(result.coverageNote);
    }
  }
}

async function getSettings(scopeUri: string): Promise<ServerSettings> {
  if (!supportsConfiguration) return DEFAULT_SETTINGS;

  try {
    const configuration: unknown = await connection.workspace.getConfiguration({
      scopeUri,
      section: "ppphp",
    });
    return compilerSettingsFromConfiguration(configuration);
  } catch (error) {
    connection.console.warn(
      [
        "Could not read ++PHP editor settings; using defaults:",
        error instanceof Error ? error.message : String(error),
      ].join(" "),
    );
    return DEFAULT_SETTINGS;
  }
}

function findWorkspaceRoot(filePath: string): string {
  const normalizedFile = path.resolve(filePath);
  return (
    workspaceFolders
      .filter(
        (folder) =>
          normalizedFile === folder ||
          normalizedFile.startsWith(`${path.resolve(folder)}${path.sep}`),
      )
      .sort((left, right) => right.length - left.length)[0] ?? path.dirname(filePath)
  );
}

function reportUnavailable(reason: string | undefined): void {
  if (reason && reason !== unavailableReason) {
    unavailableReason = reason;
    connection.console.warn(reason);
    void connection.window.showErrorMessage(`++PHP tooling unavailable: ${reason}`);
  }
}

documents.listen(connection);
connection.listen();
