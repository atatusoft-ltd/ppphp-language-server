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
import { checkFile, filePathFromUri, type CompilerSettings } from "./compiler-diagnostics.js";
import { COMPLETIONS, documentSymbols, hoverAt } from "./language-features.js";

interface PpphpConfiguration {
  compiler?: { path?: string };
  diagnostics?: { compiler?: { enabled?: boolean; timeoutMilliseconds?: number } };
}

const DEFAULT_SETTINGS: CompilerSettings = {
  enabled: true,
  timeoutMilliseconds: 10_000,
};

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
      documentSymbolProvider: true,
      hoverProvider: true,
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
connection.onHover(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  return document ? hoverAt(document, position) : null;
});
connection.onDocumentSymbol(({ textDocument }) => {
  const document = documents.get(textDocument.uri);
  return document ? documentSymbols(document) : [];
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
  const configuration = (await connection.workspace.getConfiguration({
    scopeUri,
    section: "ppphp",
  })) as PpphpConfiguration;
  const timeout = configuration.diagnostics?.compiler?.timeoutMilliseconds;
  return {
    compilerPath: configuration.compiler?.path || undefined,
    enabled: configuration.diagnostics?.compiler?.enabled ?? DEFAULT_SETTINGS.enabled,
    timeoutMilliseconds:
      typeof timeout === "number" && timeout > 0 ? timeout : DEFAULT_SETTINGS.timeoutMilliseconds,
  };
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
