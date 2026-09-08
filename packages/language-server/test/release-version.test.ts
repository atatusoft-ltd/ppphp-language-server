import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const roots: string[] = [];
it("uses the registered Marketplace publisher identity", () => {
  const manifest = JSON.parse(readFileSync(path.join(repo, "editors/vscode/package.json"), "utf8"));
  expect(manifest.publisher).toBe("AtatusoftLtd");
});
function fixture(tooling = "2026.3.1", compiler = "2026.3.1-rc-2") {
  const root = mkdtempSync(path.join(os.tmpdir(), "ppphp-release-test-"));
  roots.push(root);
  const put = (file: string, value: string | object) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  put("VERSION", tooling);
  put("COMPILER_VERSION", compiler);
  for (const folder of ["", "packages/language-server", "editors/vscode", "res/textmate/ppphp"]) {
    put(path.join(folder, "package.json"), {
      name: "ppphp-vscode",
      publisher: "AtatusoftLtd",
      version: tooling,
      ppphpToolchainVersion: compiler,
    });
  }
  put("package-lock.json", {
    version: tooling,
    packages: Object.fromEntries(
      ["", "editors/vscode", "packages/language-server"].map((key) => [key, { version: tooling }]),
    ),
  });
  put("editors/phpstorm/gradle.properties", `pluginVersion=${tooling}\n`);
  mkdirSync(path.join(root, "scripts"));
  for (const script of ["check_release_version.php", "check_vscode_package.php"])
    copyFileSync(path.join(repo, "scripts", script), path.join(root, "scripts", script));
  const run = (script = "check_release_version.php", args: string[] = []) =>
    spawnSync("php", [path.join(root, "scripts", script), ...args], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REF_TYPE: "", GITHUB_REF_NAME: "" },
    });
  return { root, put, run };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["2026.3.1", "2026.3.1-rc-2", "dev-2026.3.1"])(
  "keeps numeric tooling releases independent of compiler %s",
  (compiler) => {
    expect(fixture("2026.3.2", compiler).run().status).toBe(0);
  },
);
it.each(["2026.3.1-rc-2", "dev-2026.3.1", "2026.3.01", "0026.3.1", "2026.3.2147483648"])(
  "rejects unsupported tooling version %s",
  (version) => {
    const result = fixture(version).run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("numeric tooling CalVer");
  },
);
it("detects compiler compatibility and top-level lockfile drift", () => {
  const value = fixture();
  value.put("COMPILER_VERSION", "2026.3.1-rc-3");
  expect(value.run().stderr).toContain("ppphpToolchainVersion");
  value.put("COMPILER_VERSION", "invalid");
  expect(value.run().stderr).toContain("COMPILER_VERSION");
  value.put("COMPILER_VERSION", "2026.3.1-rc-2");
  value.put("package-lock.json", { version: "2026.3.1-rc-2" });
  expect(value.run().stderr).toContain("package-lock.json version");
});
it.each(["valid", "suffix", "publisher", "pre-release"])(
  "checks %s metadata inside the actual VSIX archive",
  (mode) => {
    const value = fixture();
    const manifest = readFileSync(path.join(value.root, "editors/vscode/package.json"), "utf8");
    const version = mode === "suffix" ? "2026.3.1-rc-2" : "2026.3.1";
    const publisher = mode === "publisher" ? "Atatusoft" : "AtatusoftLtd";
    const xml = `<PackageManifest xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Version="${version}" Publisher="${publisher}" Id="ppphp-vscode"/><Properties>${mode === "pre-release" ? '<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true"/>' : ""}</Properties></Metadata></PackageManifest>`;
    const archive = path.join(value.root, "test.zip");
    execFileSync("php", [
      "-r",
      '$zip = new PharData($argv[1]); $zip["extension/package.json"] = $argv[2]; $zip["extension.vsixmanifest"] = $argv[3];',
      archive,
      manifest,
      xml,
    ]);
    const result = value.run("check_vscode_package.php", [archive]);
    expect(result.status, result.stderr).toBe(mode === "valid" ? 0 : 1);
  },
);
