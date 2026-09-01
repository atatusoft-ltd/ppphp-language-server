import path from "node:path";
import {
  createConnection,
  DidChangeConfigurationNotification,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  type InitializeParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import packageMetadata from "../package.json";
import { findDefinitionAt } from "./compiler-definition.js";
import { checkFile, filePathFromUri, type CompilerSettings } from "./compiler-diagnostics.js";
import { classifySemanticTokens } from "./compiler-semantic-tokens.js";
import {
  handleComposerNamespaceCommand,
  INFER_COMPOSER_NAMESPACE_COMMAND,
} from "./composer-namespace.js";
import { COMPLETIONS, documentSymbols, hoverAt } from "./language-features.js";
import { SEMANTIC_TOKEN_LEGEND, semanticTokens } from "./semantic-tokens.js";
import { compilerSettingsFromConfiguration, DEFAULT_SETTINGS } from "./server-settings.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let supportsConfiguration = false;
let workspaceFolders: string[] = [];
const validationGenerations = new Map<string, number>();
let unavailableReason: string | undefined;

connection.onInitialize((params: InitializeParams) => {
  supportsConfiguration = Boolean(params.capabilities.workspace?.configuration);
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
      completionProvider: { triggerCharacters: ["<", "\\", "$", ":"] },
      definitionProvider: true,
      documentSymbolProvider: true,
      executeCommandProvider: { commands: [INFER_COMPOSER_NAMESPACE_COMMAND] },
      hoverProvider: true,
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
});

connection.onDidChangeConfiguration(() => {
  for (const document of documents.all()) void validate(document);
});

connection.onCompletion(() => [...COMPLETIONS]);
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

  if (result.unavailableReason && result.unavailableReason !== unavailableReason) {
    unavailableReason = result.unavailableReason;
    connection.console.warn(result.unavailableReason);
  }

  return result.definition;
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

  if (result.unavailableReason && result.unavailableReason !== unavailableReason) {
    unavailableReason = result.unavailableReason;
    connection.console.warn(result.unavailableReason);
  }

  return semanticTokens(document, result.tokens);
});

documents.onDidOpen(({ document }) => void validate(document));
documents.onDidSave(({ document }) => void validate(document));
documents.onDidClose(({ document }) => {
  validationGenerations.delete(document.uri);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

async function validate(document: TextDocument): Promise<void> {
  const generation = (validationGenerations.get(document.uri) ?? 0) + 1;
  validationGenerations.set(document.uri, generation);
  const filePath = filePathFromUri(document.uri);
  if (!filePath || path.extname(filePath).toLowerCase() !== ".ppphp") return;

  const workspaceRoot = findWorkspaceRoot(filePath);
  const settings = await getSettings(document.uri);
  const result = await checkFile(filePath, workspaceRoot, settings);
  if (generation !== validationGenerations.get(document.uri)) return;

  connection.sendDiagnostics({ uri: document.uri, diagnostics: result.diagnostics });
  if (result.unavailableReason && result.unavailableReason !== unavailableReason) {
    unavailableReason = result.unavailableReason;
    connection.console.warn(result.unavailableReason);
  }
}

async function getSettings(scopeUri: string): Promise<CompilerSettings> {
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

documents.listen(connection);
connection.listen();
