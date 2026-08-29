import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalVersion = (await readText("VERSION")).trim();
const versionMatch = canonicalVersion.match(
  /^(?<year>\d{4})\.(?<quarter>0[1-4])\.(?<patch>0|[1-9]\d*)(?<prerelease>-(?:canary|alpha|beta|rc)(?:\.(?:0|[1-9]\d*))?)?$/,
);

if (!versionMatch?.groups) {
  fail(
    "VERSION must use canonical ++PHP CalVer YYYY.QQ.patch[-channel], received " +
      JSON.stringify(canonicalVersion),
  );
}

const ecosystemVersion =
  versionMatch.groups.year +
  "." +
  Number(versionMatch.groups.quarter) +
  "." +
  versionMatch.groups.patch +
  (versionMatch.groups.prerelease ?? "");
const manifestExpectations = [
  ["package.json", false],
  ["packages/language-server/package.json", true],
  ["editors/vscode/package.json", true],
  ["res/textmate/ppphp/package.json", true],
];

for (const [file, carriesCanonicalVersion] of manifestExpectations) {
  const manifest = JSON.parse(await readText(file));
  expectEqual(file + " version", manifest.version, ecosystemVersion);
  if (carriesCanonicalVersion) {
    expectEqual(file + " ppphpToolchainVersion", manifest.ppphpToolchainVersion, canonicalVersion);
  }
}

const lockfile = JSON.parse(await readText("package-lock.json"));
for (const packagePath of ["", "editors/vscode", "packages/language-server"]) {
  expectEqual(
    "package-lock.json package " + JSON.stringify(packagePath) + " version",
    lockfile.packages?.[packagePath]?.version,
    ecosystemVersion,
  );
}

const gradleProperties = await readText("editors/phpstorm/gradle.properties");
const pluginVersion = /^pluginVersion=(.+)$/m.exec(gradleProperties)?.[1];
expectEqual("editors/phpstorm/gradle.properties pluginVersion", pluginVersion, canonicalVersion);

for (const file of [
  "README.md",
  "docs/releasing.md",
  "editors/vscode/README.md",
  "editors/phpstorm/README.md",
]) {
  const contents = await readText(file);
  if (!contents.includes(canonicalVersion)) {
    fail(file + " must identify the current canonical toolchain version " + canonicalVersion);
  }
}

if (process.env.GITHUB_REF_TYPE === "tag") {
  expectEqual("release tag", process.env.GITHUB_REF_NAME, "v" + canonicalVersion);
}

process.stdout.write(
  "Version metadata is consistent: " +
    canonicalVersion +
    " (" +
    ecosystemVersion +
    " for SemVer ecosystems).\n",
);

async function readText(file) {
  return readFile(path.join(repositoryRoot, file), "utf8");
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) {
    fail(label + " must be " + JSON.stringify(expected) + ", received " + JSON.stringify(actual));
  }
}

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}
