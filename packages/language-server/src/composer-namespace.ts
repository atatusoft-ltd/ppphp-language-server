import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INFER_COMPOSER_NAMESPACE_COMMAND = "ppphp.inferComposerNamespace";

export interface ComposerNamespaceResolution {
  namespace: string | null;
  authoritative: boolean;
}

interface AutoloadMapping {
  namespace: string[];
  path: string;
}

interface Inference {
  matched: boolean;
  namespace: string | null;
}

type CanonicalizePath = (candidate: string) => Promise<string>;

const NONE: ComposerNamespaceResolution = { namespace: null, authoritative: false };
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;
const PRESERVED_SECTIONS = [
  ["extra", "ppphp", "source-autoload"],
  ["extra", "ppphp", "source-autoload-dev"],
] as const;
const RUNTIME_SECTIONS = [["autoload"], ["autoload-dev"]] as const;

export async function resolveComposerNamespace(
  directory: string,
): Promise<ComposerNamespaceResolution> {
  try {
    const targetDirectory = await canonicalizePath(directory);
    const manifest = await findNearestManifest(targetDirectory);
    if (!manifest) return NONE;

    const metadata = await fs.stat(manifest);
    if (!metadata.isFile() || metadata.size > MAXIMUM_MANIFEST_BYTES) return NONE;

    const source = await fs.readFile(manifest, "utf8");
    if (Buffer.byteLength(source) > MAXIMUM_MANIFEST_BYTES) return NONE;

    return inferComposerNamespace(source, path.dirname(manifest), targetDirectory);
  } catch {
    return NONE;
  }
}

export async function inferComposerNamespace(
  source: string,
  manifestDirectory: string,
  targetDirectory: string,
  canonicalize: CanonicalizePath = canonicalizePath,
): Promise<ComposerNamespaceResolution> {
  const document = parseObject(source);
  if (!document) return NONE;

  const manifestRoot = await canonicalize(manifestDirectory);
  const targetRoot = await canonicalize(targetDirectory);
  const preserved = await infer(
    manifestRoot,
    targetRoot,
    mappings(document, PRESERVED_SECTIONS),
    canonicalize,
  );
  if (preserved.matched) {
    return { namespace: preserved.namespace, authoritative: true };
  }

  const runtime = await infer(
    manifestRoot,
    targetRoot,
    mappings(document, RUNTIME_SECTIONS),
    canonicalize,
  );
  return runtime.matched ? { namespace: runtime.namespace, authoritative: true } : NONE;
}

export async function handleComposerNamespaceCommand(
  arguments_: unknown[] | undefined,
): Promise<ComposerNamespaceResolution> {
  const request = arguments_?.[0];
  if (!isRecord(request) || typeof request.directoryUri !== "string") return NONE;

  try {
    return resolveComposerNamespace(fileURLToPath(request.directoryUri));
  } catch {
    return NONE;
  }
}

async function findNearestManifest(directory: string): Promise<string | null> {
  let current = directory;

  while (true) {
    const candidate = path.join(current, "composer.json");
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      // Keep looking in the containing package.
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function infer(
  manifestDirectory: string,
  targetDirectory: string,
  autoloadMappings: AutoloadMapping[],
  canonicalize: CanonicalizePath,
): Promise<Inference> {
  const matches: Array<{ namespace: string; pathLength: number }> = [];

  for (const mapping of autoloadMappings) {
    if (mapping.path.includes("\0")) continue;
    const configured = mapping.path.replaceAll("\\", "/");
    const mappingRoot = await canonicalize(path.resolve(manifestDirectory, configured));
    const relative = path.relative(mappingRoot, targetDirectory);

    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      continue;
    }

    const suffix = relative === "" ? [] : relative.split(path.sep);
    if (!suffix.every(isNamespaceSegment)) continue;
    matches.push({
      namespace: [...mapping.namespace, ...suffix].join("\\"),
      pathLength: mappingRoot.split(path.sep).length,
    });
  }

  if (matches.length === 0) return { matched: false, namespace: null };
  const longestPath = Math.max(...matches.map((match) => match.pathLength));
  const namespaces = [
    ...new Set(
      matches.filter((match) => match.pathLength === longestPath).map((match) => match.namespace),
    ),
  ];
  return { matched: true, namespace: namespaces.length === 1 ? (namespaces[0] ?? null) : null };
}

function mappings(
  document: Record<string, unknown>,
  sectionPaths: readonly (readonly string[])[],
): AutoloadMapping[] {
  return sectionPaths.flatMap((sectionPath) => {
    const section = readObject(document, sectionPath);
    const psr4 = section && isRecord(section["psr-4"]) ? section["psr-4"] : null;
    if (!psr4) return [];

    return Object.entries(psr4).flatMap(([prefix, configuredPaths]) => {
      const namespace = namespaceSegments(prefix);
      const paths = readPaths(configuredPaths);
      if (!namespace || !paths) return [];
      return paths.map((mappingPath) => ({ namespace, path: mappingPath }));
    });
  });
}

function readObject(
  document: Record<string, unknown>,
  objectPath: readonly string[],
): Record<string, unknown> | null {
  let current = document;
  for (const segment of objectPath) {
    const value = current[segment];
    if (!isRecord(value)) return null;
    current = value;
  }
  return current;
}

function readPaths(value: unknown): string[] | null {
  if (typeof value === "string") return value.length > 0 ? [value] : null;
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((entry) => typeof entry === "string" && entry.length > 0) ? value : null;
}

function namespaceSegments(prefix: string): string[] | null {
  const normalized = prefix.replace(/^\\+|\\+$/gu, "");
  const segments = normalized === "" ? [] : normalized.split("\\");
  return segments.every(isNamespaceSegment) ? segments : null;
}

function isNamespaceSegment(segment: string): boolean {
  return /^[A-Z_\u0080-\u{10ffff}][A-Z0-9_\u0080-\u{10ffff}]*$/iu.test(segment);
}

function parseObject(source: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(source);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function canonicalizePath(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}
