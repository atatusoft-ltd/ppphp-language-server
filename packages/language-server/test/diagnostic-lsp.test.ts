import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it, vi } from "vitest";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";

it("publishes only current worker snapshots and preserves errors when analysis is unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-diagnostic-lsp-"));
  const compiler = path.join(root, "compiler.php");
  const bundle = path.join(root, "server.cjs");
  let cleanup = async () => {};
  try {
    await copyFile(
      fileURLToPath(new URL("./fixtures/diagnostic-worker.php", import.meta.url)),
      compiler,
    );
    await writeFile(path.join(root, "mode"), "slow");
    await build({
      entryPoints: [fileURLToPath(new URL("../src/launcher.ts", import.meta.url))],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      outfile: bundle,
      logLevel: "silent",
    });
    const child = spawn(process.execPath, [bundle, "--stdio"], {
      cwd: root,
      env: { ...process.env, PPPHP_COMPILER_PATH: compiler },
      stdio: "pipe",
    });
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    cleanup = async () => {
      connection.dispose();
      child.kill();
      await closed;
    };
    const published: { uri: string; version?: number; diagnostics: unknown[] }[] = [];
    const messages: string[] = [];
    connection.onNotification("textDocument/publishDiagnostics", (result) => {
      published.push(result);
    });
    connection.onNotification("window/logMessage", (message) => {
      messages.push(message.message);
    });
    connection.onNotification("window/showMessage", (message) => {
      messages.push(message.message);
    });
    connection.onRequest("window/showMessageRequest", () => {
      throw new Error("Test client does not display modal requests");
    });
    connection.listen();
    const rootUri = pathToFileURL(root).href;
    const uri = pathToFileURL(path.join(root, "a.ppphp")).href;
    const events = async () =>
      (await readFile(path.join(root, "transport.log"), "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { type: string; version?: number; pid: number; server?: boolean },
        );
    const waitFor = (assert: () => unknown) => vi.waitFor(assert, { timeout: 5000, interval: 10 });
    const change = (version: number, text: string) =>
      connection.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    await connection.sendRequest("initialize", {
      processId: process.pid,
      rootUri,
      capabilities: {},
    });
    await connection.sendNotification("initialized", {});
    await connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "ppphp", version: 1, text: "<?php good;" },
    });
    await waitFor(() =>
      expect(published.find((item) => item.version === 1)?.diagnostics).toEqual([]),
    );
    await change(2, "<?php bad;");
    await waitFor(async () =>
      expect((await events()).some((event) => event.version === 2)).toBe(true),
    );
    await change(3, "<?php bad again;");
    await change(4, "<?php repaired;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 4)?.diagnostics).toEqual([]),
    );
    expect(published.some((item) => item.version === 2 || item.version === 3)).toBe(false);
    expect(
      (await events()).filter((event) => event.type === "request").map((event) => event.version),
    ).toEqual([1, 2, 4]);
    await change(5, "<?php bad;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 5)?.diagnostics).toHaveLength(1),
    );
    await writeFile(path.join(root, "mode"), "broken-all");
    await change(6, "<?php repaired;");
    await waitFor(() =>
      expect(messages.some((message) => message.includes("Test compiler unavailable"))).toBe(true),
    );
    expect(published.some((item) => item.version === 6)).toBe(false);
    expect(published.at(-1)?.version).toBe(5);
    await writeFile(path.join(root, "mode"), "normal");
    await change(7, "<?php repaired;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 7)?.diagnostics).toEqual([]),
    );
    const starts = (await events()).filter((event) => event.type === "start" && event.server);
    expect(starts).toHaveLength(1);
    await connection.sendRequest("shutdown");
    for (const event of starts) expect(() => process.kill(event.pid, 0)).toThrow();
    await connection.sendNotification("exit");
    await closed;
  } finally {
    await cleanup();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
