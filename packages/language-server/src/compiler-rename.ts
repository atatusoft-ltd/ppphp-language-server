import { access, lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Position,
  type Range,
  type RenameFile,
  type TextDocumentEdit,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  resolveCompilerSymbolAt,
  type CompilerSymbolDefinition,
  type CompilerSymbolResult,
} from "./compiler-definition.js";
import type { CompilerProcessSettings } from "./compiler-process.js";
import { maskNonCode } from "./language-features.js";

const MAXIMUM_DOCUMENT_BYTES = 2_097_152;
const MAXIMUM_PROJECT_DOCUMENTS = 2_048;
const MAXIMUM_RENAME_CANDIDATES = 512;
const RESOLUTION_CONCURRENCY = 4;
const TYPE_KINDS = new Set(["class", "interface", "trait", "enum"]);

export interface ProjectSourceDocument {
  document: TextDocument;
  filePath: string;
  version: number | null;
}

export interface RenameClientSupport {
  documentChanges: boolean;
  renameFileOperations: boolean;
}

export interface PrepareTypeRenameResult {
  prepare: { range: Range; placeholder: string } | null;
  unavailableReason?: string;
}

export interface TypeRenameResult {
  edit: WorkspaceEdit | null;
  rejectionReason?: string;
  unavailableReason?: string;
}

interface IdentifierOccurrence {
  name: string;
  start: number;
  end: number;
  range: Range;
}

interface ProjectOccurrence extends IdentifierOccurrence {
  source: ProjectSourceDocument;
}

interface ResolvedOccurrence {
  occurrence: ProjectOccurrence;
  result: CompilerSymbolResult;
}

type SymbolResolver = (
  document: TextDocument,
  position: Position,
  filePath: string,
  workspaceRoot: string,
  settings: CompilerProcessSettings,
) => Promise<CompilerSymbolResult>;

export interface RenameServices {
  resolveSymbol: SymbolResolver;
  loadProjectDocuments: (
    workspaceRoot: string,
    openDocuments: readonly TextDocument[],
  ) => Promise<ProjectSourceDocument[]>;
  pathExists: (candidate: string) => Promise<boolean>;
  pathsReferToSameFile: (left: string, right: string) => Promise<boolean>;
}

const DEFAULT_SERVICES: RenameServices = {
  resolveSymbol: resolveCompilerSymbolAt,
  loadProjectDocuments: discoverProjectDocuments,
  pathExists: async (candidate) => {
    try {
      await access(candidate);
      return true;
    } catch {
      return false;
    }
  },
  pathsReferToSameFile: async (left, right) => {
    try {
      const [leftStat, rightStat] = await Promise.all([stat(left), stat(right)]);
      return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
    } catch {
      return false;
    }
  },
};

export async function prepareTypeRenameAt(
  document: TextDocument,
  position: Position,
  filePath: string,
  workspaceRoot: string,
  settings: CompilerProcessSettings,
  services: Partial<RenameServices> = {},
): Promise<PrepareTypeRenameResult> {
  const activeServices = { ...DEFAULT_SERVICES, ...services };
  const occurrence = identifierAt(document, position);
  if (!occurrence) return { prepare: null };

  const result = await activeServices.resolveSymbol(
    document,
    occurrence.range.start,
    filePath,
    workspaceRoot,
    settings,
  );
  if (!result.symbol) {
    return { prepare: null, unavailableReason: result.unavailableReason };
  }
  if (!isEditableType(result.symbol, workspaceRoot, occurrence.name)) {
    return { prepare: null };
  }

  return {
    prepare: {
      range: occurrence.range,
      placeholder: occurrence.name,
    },
  };
}

export async function renameTypeAt(
  document: TextDocument,
  position: Position,
  newName: string,
  filePath: string,
  workspaceRoot: string,
  settings: CompilerProcessSettings,
  openDocuments: readonly TextDocument[],
  clientSupport: RenameClientSupport,
  services: Partial<RenameServices> = {},
): Promise<TypeRenameResult> {
  const activeServices = { ...DEFAULT_SERVICES, ...services };
  const occurrence = identifierAt(document, position);
  if (!occurrence) return rejected("Rename is available only on a declared ++PHP type.");
  if (!isIdentifier(newName)) {
    return rejected(
      "A ++PHP type name must begin with a letter or underscore and contain only letters, digits, or underscores.",
    );
  }
  if (newName === occurrence.name) {
    return rejected(`The type is already named ${newName}.`);
  }

  const targetResult = await activeServices.resolveSymbol(
    document,
    occurrence.range.start,
    filePath,
    workspaceRoot,
    settings,
  );
  if (!targetResult.symbol) {
    return targetResult.unavailableReason
      ? { edit: null, unavailableReason: targetResult.unavailableReason }
      : rejected("Rename is available only on a declared ++PHP type.");
  }
  const target = targetResult.symbol;
  if (!isEditableType(target, workspaceRoot, occurrence.name)) {
    return rejected("Rename is available only for project-owned ++PHP class-family declarations.");
  }

  let sources: ProjectSourceDocument[];
  try {
    sources = await activeServices.loadProjectDocuments(workspaceRoot, openDocuments);
  } catch (error) {
    return rejected(error instanceof Error ? error.message : String(error));
  }

  const targetSource = sources.find(
    (source) => normalizePath(source.filePath) === normalizePath(target.filePath),
  );
  if (!targetSource) {
    return rejected("The type declaration is outside the ++PHP source roots in ppphp.json.");
  }

  const candidates = collectOccurrences(sources, occurrence.name);
  if (candidates.length > MAXIMUM_RENAME_CANDIDATES) {
    return rejected(
      `Rename stopped because ${occurrence.name} has more than ${MAXIMUM_RENAME_CANDIDATES} project occurrences. Narrow the project before retrying.`,
    );
  }

  const resolved = await resolveOccurrences(
    candidates,
    workspaceRoot,
    settings,
    activeServices.resolveSymbol,
  );
  const unavailable = resolved.find(({ result }) => result.unavailableReason)?.result
    .unavailableReason;
  if (unavailable) return { edit: null, unavailableReason: unavailable };

  const matches = resolved.filter(({ result }) => result.symbol?.symbolId === target.symbolId);
  const declaration = matches.find(({ occurrence: candidate, result }) =>
    occurrenceIsDefinition(candidate, result.symbol),
  )?.occurrence;
  if (!declaration) {
    return rejected("The compiler could not identify the editable ++PHP type declaration.");
  }

  const renamedSymbolId = renamedTypeSymbolId(target.symbolId, newName);
  const collision = await findCollision(
    sources,
    target,
    targetSource,
    occurrence.name,
    newName,
    renamedSymbolId,
    workspaceRoot,
    settings,
    activeServices.resolveSymbol,
  );
  if (collision.unavailableReason) {
    return { edit: null, unavailableReason: collision.unavailableReason };
  }
  if (collision.rejectionReason) return rejected(collision.rejectionReason);

  const targetMatches = matches
    .map(({ occurrence: candidate }) => candidate)
    .filter(
      (candidate) => normalizePath(candidate.source.filePath) === normalizePath(target.filePath),
    );
  const validation = await validateRenamedDeclaration(
    targetSource,
    declaration,
    targetMatches,
    newName,
    renamedSymbolId,
    workspaceRoot,
    settings,
    activeServices.resolveSymbol,
  );
  if (validation.unavailableReason) {
    return { edit: null, unavailableReason: validation.unavailableReason };
  }
  if (!validation.valid) {
    return rejected(
      `The compiler rejected ${newName} as the replacement type name. Choose a different name.`,
    );
  }

  const fileRename = await buildFileRename(
    declaration,
    newName,
    clientSupport,
    activeServices.pathExists,
    activeServices.pathsReferToSameFile,
  );
  if (typeof fileRename === "string") return rejected(fileRename);

  return {
    edit: buildWorkspaceEdit(
      matches.map(({ occurrence: candidate }) => candidate),
      newName,
      clientSupport.documentChanges,
      fileRename,
    ),
  };
}

export function identifierAt(
  document: TextDocument,
  position: Position,
): IdentifierOccurrence | null {
  const source = document.getText();
  const searchable = maskNonCode(source);
  let start = Math.min(Math.max(document.offsetAt(position), 0), source.length);

  if (!isIdentifierPart(searchable[start]) && isIdentifierPart(searchable[start - 1])) start -= 1;
  if (!isIdentifierPart(searchable[start])) return null;

  let end = start;
  while (start > 0 && isIdentifierPart(searchable[start - 1])) start -= 1;
  while (end < searchable.length && isIdentifierPart(searchable[end])) end += 1;

  const name = source.slice(start, end);
  if (!isIdentifier(name)) return null;

  return {
    name,
    start,
    end,
    range: {
      start: document.positionAt(start),
      end: document.positionAt(end),
    },
  };
}

export async function discoverProjectDocuments(
  workspaceRoot: string,
  openDocuments: readonly TextDocument[],
): Promise<ProjectSourceDocument[]> {
  const projectRoot = path.resolve(workspaceRoot);
  const configurationPath = path.join(projectRoot, "ppphp.json");
  let configuration: unknown;

  try {
    configuration = JSON.parse(await readFile(configurationPath, "utf8"));
  } catch {
    throw new Error("Project-wide rename requires a readable ppphp.json at the workspace root.");
  }

  const record = asRecord(configuration);
  const configuredSources = stringList(record?.source);
  if (configuredSources.length === 0) {
    throw new Error("Project-wide rename requires at least one source directory in ppphp.json.");
  }

  const sourceRoots = configuredSources.map((configured) =>
    resolveProjectPath(projectRoot, configured),
  );
  const excludedRoots = [
    ...stringList(record?.exclude),
    ...[record?.output, record?.cache].filter(
      (value): value is string => typeof value === "string",
    ),
  ].map((configured) => resolveProjectPath(projectRoot, configured));
  const files = new Set<string>();

  for (const sourceRoot of sourceRoots) {
    await collectSourceFiles(sourceRoot, projectRoot, excludedRoots, files);
  }

  const openByPath = new Map<string, TextDocument>();
  for (const openDocument of openDocuments) {
    const openPath = filePathFromUri(openDocument.uri);
    if (
      !openPath ||
      path.extname(openPath).toLowerCase() !== ".ppphp" ||
      !sourceRoots.some((root) => pathIsWithin(root, openPath)) ||
      excludedRoots.some((root) => pathIsWithin(root, openPath))
    ) {
      continue;
    }
    files.add(path.resolve(openPath));
    openByPath.set(normalizePath(openPath), openDocument);
  }

  if (files.size > MAXIMUM_PROJECT_DOCUMENTS) {
    throw new Error(
      `Project-wide rename supports at most ${MAXIMUM_PROJECT_DOCUMENTS} ++PHP source files.`,
    );
  }

  const sources: ProjectSourceDocument[] = [];
  for (const sourcePath of [...files].sort()) {
    const openDocument = openByPath.get(normalizePath(sourcePath));
    const document =
      openDocument ??
      TextDocument.create(
        pathToFileURL(sourcePath).toString(),
        "ppphp",
        0,
        await readFile(sourcePath, "utf8"),
      );
    if (Buffer.byteLength(document.getText(), "utf8") > MAXIMUM_DOCUMENT_BYTES) {
      throw new Error(
        `Project-wide rename cannot inspect files larger than two megabytes: ${sourcePath}`,
      );
    }
    sources.push({
      document,
      filePath: sourcePath,
      version: openDocument ? openDocument.version : null,
    });
  }

  return sources;
}

function isEditableType(
  symbol: CompilerSymbolDefinition,
  workspaceRoot: string,
  occurrenceName: string,
): boolean {
  if (
    !symbol.symbolId.startsWith("type:") ||
    !TYPE_KINDS.has(symbol.kind) ||
    path.extname(symbol.filePath).toLowerCase() !== ".ppphp" ||
    !pathIsWithin(workspaceRoot, symbol.filePath)
  ) {
    return false;
  }

  const separator = symbol.symbolId.lastIndexOf("\\");
  const declaredName = symbol.symbolId.slice(separator + 1);
  return declaredName === occurrenceName.toLowerCase();
}

function collectOccurrences(
  sources: readonly ProjectSourceDocument[],
  name: string,
): ProjectOccurrence[] {
  return sources.flatMap((source) =>
    identifierOccurrences(source.document, name).map((occurrence) => ({
      ...occurrence,
      source,
    })),
  );
}

function identifierOccurrences(document: TextDocument, name: string): IdentifierOccurrence[] {
  const source = document.getText();
  const searchable = maskNonCode(source);
  const expected = name.toLowerCase();
  const occurrences: IdentifierOccurrence[] = [];
  let offset = 0;

  while (offset < searchable.length) {
    if (!isIdentifierStart(searchable[offset])) {
      offset += 1;
      continue;
    }

    let end = offset + 1;
    while (end < searchable.length && isIdentifierPart(searchable[end])) end += 1;
    const candidate = source.slice(offset, end);
    if (candidate.toLowerCase() === expected) {
      occurrences.push({
        name: candidate,
        start: offset,
        end,
        range: {
          start: document.positionAt(offset),
          end: document.positionAt(end),
        },
      });
    }
    offset = end;
  }

  return occurrences;
}

async function resolveOccurrences(
  occurrences: readonly ProjectOccurrence[],
  workspaceRoot: string,
  settings: CompilerProcessSettings,
  resolveSymbol: SymbolResolver,
): Promise<ResolvedOccurrence[]> {
  return parallelMap(occurrences, RESOLUTION_CONCURRENCY, async (occurrence) => ({
    occurrence,
    result: await resolveSymbol(
      occurrence.source.document,
      occurrence.range.start,
      occurrence.source.filePath,
      workspaceRoot,
      settings,
    ),
  }));
}

async function findCollision(
  sources: readonly ProjectSourceDocument[],
  target: CompilerSymbolDefinition,
  targetSource: ProjectSourceDocument,
  oldName: string,
  newName: string,
  renamedSymbolId: string,
  workspaceRoot: string,
  settings: CompilerProcessSettings,
  resolveSymbol: SymbolResolver,
): Promise<{ rejectionReason?: string; unavailableReason?: string }> {
  if (oldName.toLowerCase() === newName.toLowerCase()) return {};

  const candidates = collectOccurrences(sources, newName);
  if (candidates.length > MAXIMUM_RENAME_CANDIDATES) {
    return {
      rejectionReason: `Rename stopped because ${newName} has more than ${MAXIMUM_RENAME_CANDIDATES} project occurrences.`,
    };
  }
  const resolved = await resolveOccurrences(candidates, workspaceRoot, settings, resolveSymbol);

  for (const { occurrence, result } of resolved) {
    if (result.unavailableReason) return { unavailableReason: result.unavailableReason };
    const symbol = result.symbol;
    if (!symbol || !symbol.symbolId.startsWith("type:")) continue;
    if (symbol.symbolId === renamedSymbolId && symbol.symbolId !== target.symbolId) {
      return { rejectionReason: `A type named ${newName} already exists in the target namespace.` };
    }
    if (
      normalizePath(occurrence.source.filePath) === normalizePath(targetSource.filePath) &&
      symbol.symbolId !== target.symbolId
    ) {
      return {
        rejectionReason: `${newName} already resolves to another type in the declaration file.`,
      };
    }
  }

  return {};
}

async function validateRenamedDeclaration(
  targetSource: ProjectSourceDocument,
  declaration: ProjectOccurrence,
  targetMatches: readonly ProjectOccurrence[],
  newName: string,
  renamedSymbolId: string,
  workspaceRoot: string,
  settings: CompilerProcessSettings,
  resolveSymbol: SymbolResolver,
): Promise<{ valid: boolean; unavailableReason?: string }> {
  const text = applyOccurrences(targetSource.document.getText(), targetMatches, newName);
  const precedingDelta = targetMatches
    .filter((candidate) => candidate.start < declaration.start)
    .reduce((delta, candidate) => delta + newName.length - (candidate.end - candidate.start), 0);
  const declarationStart = declaration.start + precedingDelta;
  const document = TextDocument.create(
    targetSource.document.uri,
    "ppphp",
    targetSource.document.version + 1,
    text,
  );
  const result = await resolveSymbol(
    document,
    document.positionAt(declarationStart),
    targetSource.filePath,
    workspaceRoot,
    settings,
  );

  return {
    valid:
      result.symbol?.symbolId === renamedSymbolId &&
      normalizePath(result.symbol.filePath) === normalizePath(targetSource.filePath),
    unavailableReason: result.unavailableReason,
  };
}

async function buildFileRename(
  declaration: ProjectOccurrence,
  newName: string,
  clientSupport: RenameClientSupport,
  pathExists: (candidate: string) => Promise<boolean>,
  pathsReferToSameFile: (left: string, right: string) => Promise<boolean>,
): Promise<RenameFile | null | string> {
  const sourcePath = declaration.source.filePath;
  const extension = path.extname(sourcePath);
  const basename = path.basename(sourcePath, extension);
  if (basename.toLowerCase() !== declaration.name.toLowerCase()) return null;

  const destinationPath = path.join(path.dirname(sourcePath), `${newName}.ppphp`);
  if (sourcePath === destinationPath) return null;
  if (!clientSupport.documentChanges || !clientSupport.renameFileOperations) {
    return "This editor cannot apply the file rename required for a class-family refactor.";
  }

  if (
    (await pathExists(destinationPath)) &&
    !(await pathsReferToSameFile(sourcePath, destinationPath))
  ) {
    return `The refactor would overwrite ${path.basename(destinationPath)}.`;
  }

  return {
    kind: "rename",
    oldUri: pathToFileURL(sourcePath).toString(),
    newUri: pathToFileURL(destinationPath).toString(),
    options: { overwrite: false, ignoreIfExists: false },
  };
}

function buildWorkspaceEdit(
  occurrences: readonly ProjectOccurrence[],
  newName: string,
  supportsDocumentChanges: boolean,
  fileRename: RenameFile | null,
): WorkspaceEdit {
  const grouped = new Map<string, { source: ProjectSourceDocument; edits: TextEdit[] }>();
  for (const occurrence of occurrences) {
    const uri = occurrence.source.document.uri;
    const group = grouped.get(uri) ?? { source: occurrence.source, edits: [] };
    group.edits.push({ range: occurrence.range, newText: newName });
    grouped.set(uri, group);
  }

  const ordered = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [, group] of ordered) {
    group.edits.sort((left, right) =>
      left.range.start.line === right.range.start.line
        ? left.range.start.character - right.range.start.character
        : left.range.start.line - right.range.start.line,
    );
  }

  if (supportsDocumentChanges) {
    const documentChanges: Array<TextDocumentEdit | RenameFile> = ordered.map(([uri, group]) => ({
      textDocument: { uri, version: group.source.version },
      edits: group.edits,
    }));
    if (fileRename) documentChanges.push(fileRename);
    return { documentChanges };
  }

  return {
    changes: Object.fromEntries(ordered.map(([uri, group]) => [uri, group.edits])),
  };
}

function occurrenceIsDefinition(
  occurrence: ProjectOccurrence,
  symbol: CompilerSymbolDefinition | null,
): boolean {
  if (!symbol || normalizePath(symbol.filePath) !== normalizePath(occurrence.source.filePath)) {
    return false;
  }
  const text = occurrence.source.document.getText();
  return (
    symbol.selectionRange.start === utf8OffsetAt(text, occurrence.start) &&
    symbol.selectionRange.end === utf8OffsetAt(text, occurrence.end)
  );
}

function renamedTypeSymbolId(symbolId: string, newName: string): string {
  const separator = symbolId.lastIndexOf("\\");
  const prefix = separator === -1 ? "type:" : symbolId.slice(0, separator + 1);
  return `${prefix}${newName.toLowerCase()}`;
}

function applyOccurrences(
  source: string,
  occurrences: readonly IdentifierOccurrence[],
  replacement: string,
): string {
  return [...occurrences]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, occurrence) =>
        current.slice(0, occurrence.start) + replacement + current.slice(occurrence.end),
      source,
    );
}

async function collectSourceFiles(
  candidate: string,
  projectRoot: string,
  excludedRoots: readonly string[],
  files: Set<string>,
): Promise<void> {
  if (
    !pathIsWithin(projectRoot, candidate) ||
    excludedRoots.some((root) => pathIsWithin(root, candidate))
  ) {
    return;
  }

  let metadata;
  try {
    metadata = await lstat(candidate);
  } catch {
    throw new Error(`The ++PHP source path does not exist: ${candidate}`);
  }

  if (metadata.isSymbolicLink()) return;

  if (metadata.isFile()) {
    if (path.extname(candidate).toLowerCase() === ".ppphp") files.add(path.resolve(candidate));
    return;
  }
  if (!metadata.isDirectory()) return;

  const entries = await readdir(candidate, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    await collectSourceFiles(path.join(candidate, entry.name), projectRoot, excludedRoots, files);
    if (files.size > MAXIMUM_PROJECT_DOCUMENTS) return;
  }
}

async function parallelMap<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await map(values[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

function resolveProjectPath(projectRoot: string, configured: string): string {
  const resolved = path.resolve(projectRoot, configured);
  if (!pathIsWithin(projectRoot, resolved)) {
    throw new Error(
      `Project-wide rename will not inspect paths outside the workspace: ${configured}`,
    );
  }
  return resolved;
}

export function pathIsWithin(
  root: string,
  candidate: string,
  platform: Pick<typeof path, "relative" | "resolve" | "isAbsolute" | "sep"> = path,
): boolean {
  const relative = platform.relative(platform.resolve(root), platform.resolve(candidate));
  return (
    relative === "" ||
    (!platform.isAbsolute(relative) &&
      !relative.startsWith(`..${platform.sep}`) &&
      relative !== "..")
  );
}

function normalizePath(candidate: string): string {
  return path.normalize(path.resolve(candidate));
}

function filePathFromUri(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

function utf8OffsetAt(text: string, utf16Offset: number): number {
  return Buffer.byteLength(text.slice(0, utf16Offset), "utf8");
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item !== "")
    : [];
}

function rejected(reason: string): TypeRenameResult {
  return { edit: null, rejectionReason: reason };
}
