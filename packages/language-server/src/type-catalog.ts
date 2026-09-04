import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { discoverProjectDocuments, pathIsWithin } from "./compiler-rename.js";
import { compilerProcessEnvironment } from "./compiler-process.js";
import { maskNonCode } from "./language-features.js";
import { phpNamespaceDeclarations } from "./php-syntax.js";

export type TypeKind = "class" | "interface" | "trait" | "enum";
export type TypeOrigin = "project" | "dependency" | "php-runtime";

export interface TypeCatalogEntry {
  name: string;
  namespace: string;
  fqn: string;
  kind: TypeKind;
  abstract: boolean;
  final: boolean;
  instantiable: boolean;
  attribute: boolean;
  origin: TypeOrigin;
}

interface CatalogCacheEntry {
  createdAt: number;
  catalog: Promise<SavedTypeCatalog>;
}

interface SavedTypeCatalog {
  external: TypeCatalogEntry[];
  projectByFile: Map<string, TypeCatalogEntry[]>;
}

interface ComposerSourceFile {
  filePath: string;
  origin: Exclude<TypeOrigin, "php-runtime">;
}

interface ComposerSourceRoot extends ComposerSourceFile {
  packageRoot: string;
  excluded: RegExp[];
}

interface InstalledPackage extends Record<string, unknown> {
  "install-path"?: unknown;
  autoload?: unknown;
  "autoload-dev"?: unknown;
  extra?: unknown;
}

const CATALOG_CACHE_MILLISECONDS = 30_000;
const MAXIMUM_SOURCE_FILES = 50_000;
const MAXIMUM_SOURCE_BYTES = 2_097_152;
const SOURCE_EXTENSIONS = new Set([".php", ".inc", ".ppphp"]);
const cache = new Map<string, CatalogCacheEntry>();
let phpRuntimeTypes: Promise<TypeCatalogEntry[]> | undefined;

export async function getTypeCatalog(
  workspaceRoot: string,
  openDocuments: readonly TextDocument[] = [],
): Promise<TypeCatalogEntry[]> {
  const root = path.resolve(workspaceRoot);
  const now = Date.now();
  let cached = cache.get(root);
  if (!cached || now - cached.createdAt >= CATALOG_CACHE_MILLISECONDS) {
    cached = { createdAt: now, catalog: buildSavedTypeCatalog(root) };
    cache.set(root, cached);
  }

  const saved = await cached.catalog;
  const openPaths = new Set<string>();
  const open = openDocuments.flatMap((document) => {
    const filePath = filePathFromUri(document.uri);
    if (
      !filePath ||
      path.extname(filePath).toLowerCase() !== ".ppphp" ||
      !pathIsWithin(root, filePath)
    ) {
      return [];
    }
    openPaths.add(normalizePath(filePath));
    return parseTypeDeclarations(document.getText(), "project");
  });
  const savedProject = [...saved.projectByFile]
    .filter(([filePath]) => !openPaths.has(filePath))
    .flatMap(([, types]) => types);
  return mergeTypeCatalog([...saved.external, ...savedProject, ...open]);
}

export function invalidateTypeCatalog(workspaceRoot?: string): void {
  if (workspaceRoot === undefined) {
    cache.clear();
  } else {
    cache.delete(path.resolve(workspaceRoot));
  }
}

export async function runTypeCatalogCommand(workspaceRoot: string): Promise<{
  version: 1;
  types: TypeCatalogEntry[];
}> {
  return { version: 1, types: await getTypeCatalog(workspaceRoot) };
}

export function parseTypeDeclarations(
  source: string,
  origin: Exclude<TypeOrigin, "php-runtime">,
): TypeCatalogEntry[] {
  const searchable = maskNonCode(source);
  const tokens = tokenize(searchable);
  const namespaces = new Map(
    phpNamespaceDeclarations(searchable).map((declaration) => [declaration.start, declaration]),
  );
  const declarations: TypeCatalogEntry[] = [];
  const namespaceStack: Array<{ depth: number; namespace: string; scopeStart: number }> = [];
  let namespace = "";
  let namespaceScopeStart = searchable.indexOf("<?php") + 5;
  if (namespaceScopeStart < 5) namespaceScopeStart = 0;
  let braceDepth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;

    if (token.text === "{") {
      braceDepth += 1;
      continue;
    }
    if (token.text === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      const scope = namespaceStack.at(-1);
      if (scope?.depth === braceDepth) {
        namespace = scope.namespace;
        namespaceScopeStart = scope.scopeStart;
        namespaceStack.pop();
      }
      continue;
    }

    const keyword = token.text.toLowerCase();
    const parsedNamespace = keyword === "namespace" ? namespaces.get(token.offset) : undefined;
    if (parsedNamespace) {
      if (parsedNamespace.delimiter === "{") {
        namespaceStack.push({ depth: braceDepth, namespace, scopeStart: namespaceScopeStart });
        namespace = parsedNamespace.namespace;
        namespaceScopeStart = parsedNamespace.anchor;
      } else {
        namespace = parsedNamespace.namespace;
        namespaceScopeStart = parsedNamespace.anchor;
      }
      const delimiterIndex = tokens.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && candidate.offset === parsedNamespace.delimiterOffset,
      );
      if (delimiterIndex >= 0) index = delimiterIndex - 1;
      continue;
    }

    const context = declarationContext(searchable, token.offset);
    if (
      !isTypeKind(keyword) ||
      /::\s*$/u.test(searchable.slice(0, context.start)) ||
      (keyword === "class" && /\bnew\s*$/iu.test(searchable.slice(0, context.start)))
    ) {
      continue;
    }
    const nameToken = tokens[index + 1];
    if (
      !nameToken ||
      !isIdentifier(nameToken.text) ||
      !/^\s+$/u.test(searchable.slice(token.offset + token.text.length, nameToken.offset))
    ) {
      continue;
    }
    const name = nameToken.text;

    const fqn = namespace === "" ? name : `${namespace}\\${name}`;
    declarations.push({
      name,
      namespace,
      fqn,
      kind: keyword,
      abstract: keyword === "class" && context.modifiers.includes("abstract"),
      final: keyword === "class" && context.modifiers.includes("final"),
      instantiable: keyword === "class" && !context.modifiers.includes("abstract"),
      attribute:
        keyword === "class" &&
        declaresAttribute(
          context.attributes,
          searchable,
          namespaceScopeStart,
          token.offset,
          namespace,
        ),
      origin,
    });
  }

  return declarations;
}

function declarationContext(
  source: string,
  declarationOffset: number,
): {
  start: number;
  modifiers: string[];
  attributes: string[];
} {
  let offset = skipWhitespaceBackward(source, declarationOffset);
  const modifiers: string[] = [];
  const attributes: string[] = [];

  while (offset > 0) {
    const modifier = /\b(abstract|final|readonly)$/iu.exec(source.slice(0, offset));
    if (modifier?.index !== undefined) {
      modifiers.unshift((modifier[1] ?? "").toLowerCase());
      offset = skipWhitespaceBackward(source, modifier.index);
      continue;
    }
    if (source[offset - 1] !== "]") break;

    const start = attributeStart(source, offset);
    if (start === null) break;
    attributes.unshift(source.slice(start, offset));
    offset = skipWhitespaceBackward(source, start);
  }

  return { start: offset, modifiers, attributes };
}

function skipWhitespaceBackward(source: string, offset: number): number {
  while (offset > 0 && /\s/u.test(source[offset - 1] ?? "")) offset -= 1;
  return offset;
}

function attributeStart(source: string, end: number): number | null {
  let depth = 1;
  let cursor = end - 2;
  for (; cursor >= 0 && depth > 0; cursor -= 1) {
    if (source[cursor] === "]") depth += 1;
    if (source[cursor] === "[") depth -= 1;
  }
  return depth === 0 && cursor >= 0 && source[cursor] === "#" ? cursor : null;
}

function declaresAttribute(
  groups: readonly string[],
  source: string,
  scopeStart: number,
  declarationOffset: number,
  namespace: string,
): boolean {
  if (groups.length === 0) return false;
  const aliases = importedAttributeAliases(source, scopeStart, declarationOffset);
  for (const group of groups) {
    for (const name of attributeNames(group)) {
      if (name.toLowerCase() === "\\attribute") return true;
      if (!name.includes("\\")) {
        if (namespace === "" && name.toLowerCase() === "attribute") return true;
        if (aliases.has(name.toLowerCase())) return true;
      }
    }
  }
  return false;
}

function importedAttributeAliases(source: string, start: number, end: number): Set<string> {
  const aliases = new Set<string>();
  const body = source.slice(start, end);
  const imports = body.matchAll(
    /\buse\s+\\?Attribute(?:\s+as\s+([A-Z_\u0080-\u{10ffff}][A-Z0-9_\u0080-\u{10ffff}]*))?\s*;/giu,
  );
  let depth = 0;
  let scannedThrough = 0;
  for (const imported of imports) {
    const offset = imported.index ?? 0;
    for (let cursor = scannedThrough; cursor < offset; cursor += 1) {
      if (body[cursor] === "{") depth += 1;
      if (body[cursor] === "}") depth = Math.max(0, depth - 1);
    }
    scannedThrough = offset;
    if (depth === 0) aliases.add((imported[1] ?? "Attribute").toLowerCase());
  }
  return aliases;
}

function attributeNames(group: string): string[] {
  const body = group.slice(2, -1);
  const names: string[] = [];
  let parentheses = 0;
  let brackets = 0;
  let segmentStart = 0;
  for (let offset = 0; offset <= body.length; offset += 1) {
    const character = body[offset];
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses = Math.max(0, parentheses - 1);
    if (character === "[") brackets += 1;
    if (character === "]") brackets = Math.max(0, brackets - 1);
    if (offset < body.length && (character !== "," || parentheses !== 0 || brackets !== 0)) {
      continue;
    }
    const name = /^\s*(\\?[A-Z_\u0080-\u{10ffff}][A-Z0-9_\\\u0080-\u{10ffff}]*)/iu.exec(
      body.slice(segmentStart, offset),
    )?.[1];
    if (name) names.push(name);
    segmentStart = offset + 1;
  }
  return names;
}

function tokenize(source: string): Array<{ text: string; offset: number }> {
  const tokens: Array<{ text: string; offset: number }> = [];
  const expression = /[A-Z_\u0080-\u{10ffff}][A-Z0-9_\u0080-\u{10ffff}]*|::|\\|[{};]/giu;
  for (const match of source.matchAll(expression)) {
    if (match.index !== undefined) tokens.push({ text: match[0], offset: match.index });
  }
  return tokens;
}

async function buildSavedTypeCatalog(workspaceRoot: string): Promise<SavedTypeCatalog> {
  const [project, composerSources, builtins] = await Promise.all([
    discoverProjectDocuments(workspaceRoot, []).catch(() => []),
    discoverComposerSourceFiles(workspaceRoot).catch(() => []),
    getPhpRuntimeTypes(),
  ]);
  const projectPaths = new Set(project.map(({ filePath }) => normalizePath(filePath)));
  const projectByFile = new Map(
    project.map(({ filePath, document }) => [
      normalizePath(filePath),
      parseTypeDeclarations(document.getText(), "project"),
    ]),
  );
  const composerTypes = await mapWithConcurrency(
    composerSources.filter(({ filePath }) => !projectPaths.has(normalizePath(filePath))),
    8,
    async ({ filePath, origin }) => {
      try {
        const source = await readFile(filePath, "utf8");
        if (Buffer.byteLength(source, "utf8") > MAXIMUM_SOURCE_BYTES) return [];
        return parseTypeDeclarations(source, origin);
      } catch {
        return [];
      }
    },
  );

  return {
    external: mergeTypeCatalog([...builtins, ...composerTypes.flat()]),
    projectByFile,
  };
}

async function discoverComposerSourceFiles(workspaceRoot: string): Promise<ComposerSourceFile[]> {
  const root = path.resolve(workspaceRoot);
  const manifest = await readJson(path.join(root, "composer.json"));
  if (!isRecord(manifest)) return [];

  const vendorDirectory = path.resolve(
    root,
    readNestedString(manifest, ["config", "vendor-dir"]) ?? "vendor",
  );
  const roots: ComposerSourceRoot[] = autoloadRoots(manifest, root, "project");
  const installed = await readJson(path.join(vendorDirectory, "composer", "installed.json"));
  for (const package_ of installedPackages(installed)) {
    if (typeof package_["install-path"] !== "string") continue;
    const packageRoot = path.resolve(vendorDirectory, "composer", package_["install-path"]);
    if (!pathIsWithin(vendorDirectory, packageRoot)) continue;
    roots.push(...autoloadRoots(package_, packageRoot, "dependency"));
  }

  const files = new Map<string, ComposerSourceFile>();
  for (const rootEntry of roots) {
    await collectSourceFiles(
      rootEntry.filePath,
      rootEntry.origin,
      rootEntry.packageRoot,
      rootEntry.excluded,
      files,
    );
    if (files.size >= MAXIMUM_SOURCE_FILES) break;
  }
  return [...files.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function autoloadRoots(
  manifest: Record<string, unknown>,
  packageRoot: string,
  origin: Exclude<TypeOrigin, "php-runtime">,
): ComposerSourceRoot[] {
  const sections = [manifest.autoload, manifest["autoload-dev"]];
  const extra = isRecord(manifest.extra) ? manifest.extra : undefined;
  const ppphp = extra && isRecord(extra.ppphp) ? extra.ppphp : undefined;
  sections.push(ppphp?.["source-autoload"], ppphp?.["source-autoload-dev"]);

  const roots: ComposerSourceRoot[] = [];
  for (const sectionValue of sections) {
    if (!isRecord(sectionValue)) continue;
    const excluded = stringValues(sectionValue["exclude-from-classmap"])
      .map(composerExcludePattern)
      .filter((pattern): pattern is RegExp => pattern !== null);
    const configuredPaths: string[] = [];
    for (const mapping of [sectionValue["psr-4"], sectionValue["psr-0"]]) {
      if (!isRecord(mapping)) continue;
      for (const value of Object.values(mapping)) configuredPaths.push(...stringValues(value));
    }
    configuredPaths.push(...stringValues(sectionValue.classmap));
    roots.push(
      ...configuredPaths
        .map((configured) => path.resolve(packageRoot, configured))
        .filter((candidate) => pathIsWithin(packageRoot, candidate))
        .map((filePath) => ({ filePath, origin, packageRoot, excluded })),
    );
  }
  return roots;
}

async function collectSourceFiles(
  candidate: string,
  origin: Exclude<TypeOrigin, "php-runtime">,
  packageRoot: string,
  excluded: readonly RegExp[],
  files: Map<string, ComposerSourceFile>,
): Promise<void> {
  if (files.size >= MAXIMUM_SOURCE_FILES || isComposerExcluded(candidate, packageRoot, excluded)) {
    return;
  }
  let metadata;
  try {
    metadata = await lstat(candidate);
  } catch {
    return;
  }
  if (metadata.isSymbolicLink()) return;
  if (metadata.isFile()) {
    if (
      metadata.size <= MAXIMUM_SOURCE_BYTES &&
      SOURCE_EXTENSIONS.has(path.extname(candidate).toLowerCase())
    ) {
      files.set(normalizePath(candidate), { filePath: path.resolve(candidate), origin });
    }
    return;
  }
  if (!metadata.isDirectory()) return;

  const entries = await readdir(candidate, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    await collectSourceFiles(
      path.join(candidate, entry.name),
      origin,
      packageRoot,
      excluded,
      files,
    );
    if (files.size >= MAXIMUM_SOURCE_FILES) return;
  }
}

function composerExcludePattern(pattern: string): RegExp | null {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized === "") return null;
  const expression = normalized
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^/${expression}.*$`, "iu");
}

function isComposerExcluded(
  candidate: string,
  packageRoot: string,
  patterns: readonly RegExp[],
): boolean {
  const relative = path.relative(packageRoot, candidate).replaceAll(path.sep, "/");
  return patterns.some((pattern) => pattern.test(`/${relative}`));
}

function getPhpRuntimeTypes(): Promise<TypeCatalogEntry[]> {
  phpRuntimeTypes ??= new Promise((resolve) => {
    execFile(
      process.platform === "win32" ? "php.exe" : "php",
      ["-r", PHP_RUNTIME_CATALOG_SCRIPT],
      {
        encoding: "utf8",
        env: compilerProcessEnvironment(),
        maxBuffer: 4 * 1024 * 1024,
        timeout: 5_000,
      },
      (_error, stdout) => {
        try {
          const decoded: unknown = JSON.parse(stdout);
          resolve(Array.isArray(decoded) ? decoded.filter(isTypeCatalogEntry) : []);
        } catch {
          resolve([]);
        }
      },
    );
  });
  return phpRuntimeTypes;
}

function mergeTypeCatalog(entries: readonly TypeCatalogEntry[]): TypeCatalogEntry[] {
  const merged = new Map<string, TypeCatalogEntry>();
  for (const entry of entries) {
    if (!isTypeCatalogEntry(entry)) continue;
    const key = entry.fqn.toLowerCase();
    const existing = merged.get(key);
    if (!existing || originRank(entry.origin) >= originRank(existing.origin)) {
      merged.set(key, entry);
    }
  }
  return [...merged.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.fqn.localeCompare(right.fqn),
  );
}

function isTypeCatalogEntry(value: unknown): value is TypeCatalogEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    isIdentifier(value.name) &&
    typeof value.namespace === "string" &&
    typeof value.fqn === "string" &&
    value.fqn !== "" &&
    isTypeKind(value.kind) &&
    typeof value.abstract === "boolean" &&
    typeof value.final === "boolean" &&
    typeof value.instantiable === "boolean" &&
    typeof value.attribute === "boolean" &&
    (value.origin === "project" || value.origin === "dependency" || value.origin === "php-runtime")
  );
}

function installedPackages(value: unknown): InstalledPackage[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value) || !Array.isArray(value.packages)) return [];
  return value.packages.filter(isRecord);
}

async function readJson(candidate: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(candidate, "utf8"));
  } catch {
    return null;
  }
}

function readNestedString(value: Record<string, unknown>, keys: readonly string[]): string | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" && current !== "" ? current : null;
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return value === "" ? [] : [value];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "")
    : [];
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await map(values[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
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

function isTypeKind(value: unknown): value is TypeKind {
  return value === "class" || value === "interface" || value === "trait" || value === "enum";
}

function isIdentifier(value: string): boolean {
  return /^[A-Z_\u0080-\u{10ffff}][A-Z0-9_\u0080-\u{10ffff}]*$/iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function originRank(origin: TypeOrigin): number {
  return origin === "project" ? 3 : origin === "dependency" ? 2 : 1;
}

const PHP_RUNTIME_CATALOG_SCRIPT = String.raw`
$result = [];
$groups = [
    'class' => get_declared_classes(),
    'interface' => get_declared_interfaces(),
    'trait' => get_declared_traits(),
];
foreach ($groups as $kind => $names) {
    foreach ($names as $name) {
        $reflection = new ReflectionClass($name);
        if (!$reflection->isInternal()) continue;
        $actualKind = $reflection->isEnum() ? 'enum' : $kind;
        $result[] = [
            'name' => $reflection->getShortName(),
            'namespace' => $reflection->getNamespaceName(),
            'fqn' => ltrim($reflection->getName(), '\\'),
            'kind' => $actualKind,
            'abstract' => $reflection->isAbstract(),
            'final' => $reflection->isFinal(),
            'instantiable' => $reflection->isInstantiable(),
            'attribute' => count($reflection->getAttributes(Attribute::class)) > 0,
            'origin' => 'php-runtime',
        ];
    }
}
echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
`;
