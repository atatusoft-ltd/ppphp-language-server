import { constants, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "res", "textmate", "ppphp");
const targetRoot = path.join(repositoryRoot, "editors", "vscode");
const mappings = [
  ["language-configuration.json", "language-configuration.json"],
  ["syntaxes/ppphp.tmLanguage.json", "syntaxes/ppphp.tmLanguage.json"],
];
const checkOnly = process.argv.includes("--check");
let different = false;

for (const [sourceName, targetName] of mappings) {
  const source = path.join(sourceRoot, sourceName);
  const target = path.join(targetRoot, targetName);
  if (checkOnly) {
    const [sourceContents, targetContents] = await Promise.all([
      readFile(source),
      readFile(target).catch(() => null),
    ]);
    if (!targetContents || !sourceContents.equals(targetContents)) {
      process.stderr.write(`${targetName} is stale; run npm run sync:resources.\n`);
      different = true;
    }
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target, constants.COPYFILE_FICLONE);
  }
}

if (different) process.exitCode = 1;
