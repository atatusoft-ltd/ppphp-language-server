import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(extensionRoot, "../..");
const outputDirectory = path.join(extensionRoot, "dist");

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });
await mkdir(path.join(repositoryRoot, "build"), { recursive: true });
await build({
  entryPoints: [path.join(extensionRoot, "src", "extension.ts")],
  outfile: path.join(outputDirectory, "extension.cjs"),
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  sourcemap: false,
  target: "node20",
});
await copyFile(
  path.join(repositoryRoot, "packages", "language-server", "dist", "server.cjs"),
  path.join(outputDirectory, "server.cjs"),
);
await copyFile(path.join(repositoryRoot, "LICENSE"), path.join(extensionRoot, "LICENSE"));
