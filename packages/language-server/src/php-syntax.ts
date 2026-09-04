const IDENTIFIER = "[A-Z_\\u0080-\\u{10ffff}][A-Z0-9_\\u0080-\\u{10ffff}]*";
const NAMESPACE = new RegExp(
  `\\bnamespace(?:\\s+(${IDENTIFIER}(?:\\\\${IDENTIFIER})*))?\\s*([;{])`,
  "giu",
);

export interface PhpNamespaceDeclaration {
  namespace: string;
  start: number;
  anchor: number;
  delimiter: ";" | "{";
  delimiterOffset: number;
}

/** Finds namespace declarations without confusing expressions such as Foo::namespace. */
export function phpNamespaceDeclarations(source: string): PhpNamespaceDeclaration[] {
  const declarations: PhpNamespaceDeclaration[] = [];
  let braceDepth = 0;
  let scannedThrough = 0;

  for (const match of source.matchAll(NAMESPACE)) {
    const start = match.index ?? 0;
    braceDepth = braceDepthAfter(source, scannedThrough, start, braceDepth);
    scannedThrough = start;
    if (braceDepth !== 0 || !beginsNamespaceStatement(source, start)) continue;

    const delimiter = match[2] === "{" ? "{" : ";";
    const delimiterOffset = start + match[0].lastIndexOf(delimiter);
    declarations.push({
      namespace: match[1] ?? "",
      start,
      anchor: delimiterOffset + 1,
      delimiter,
      delimiterOffset,
    });
  }

  return declarations;
}

function braceDepthAfter(source: string, start: number, end: number, initial: number): number {
  let depth = initial;
  for (let offset = start; offset < end; offset += 1) {
    if (source[offset] === "{") depth += 1;
    if (source[offset] === "}") depth = Math.max(0, depth - 1);
  }
  return depth;
}

function beginsNamespaceStatement(source: string, offset: number): boolean {
  let previous = offset - 1;
  while (previous >= 0 && /\s/u.test(source[previous] ?? "")) previous -= 1;
  if (previous < 0 || source[previous] === ";" || source[previous] === "}") return true;
  return /<\?php$/iu.test(source.slice(0, previous + 1));
}
