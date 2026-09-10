import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it, vi } from "vitest";
import packageMetadata from "../package.json";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";

it("replaces obsolete findings with current analysis failures and recovers without stale publications", async () => {
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
    let configuration = {};
    connection.onRequest("workspace/configuration", ({ items }: { items: unknown[] }) =>
      items.map(() => configuration),
    );
    connection.onRequest("client/registerCapability", () => null);
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
            JSON.parse(line) as {
              type: string;
              version?: number;
              pid: number;
              server?: boolean;
              memoryLimit?: string;
              memoryLimitEnvironment?: string;
            },
        );
    const waitFor = (assert: () => unknown) => vi.waitFor(assert, { timeout: 5000, interval: 10 });
    const change = (version: number, text: string) =>
      connection.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    const initialization = await connection.sendRequest<{ serverInfo: { version: string } }>(
      "initialize",
      {
        processId: process.pid,
        rootUri,
        capabilities: {
          workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } },
        },
      },
    );
    expect(initialization.serverInfo.version).toBe(packageMetadata.version);
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
    const expectUnavailable = (version: number, reason: string) => {
      expect(published.find((item) => item.version === version)?.diagnostics).toEqual([
        expect.objectContaining({
          source: "++PHP tooling",
          code: "analysis-unavailable",
          severity: 2,
          message: expect.stringContaining(reason),
        }),
      ]);
    };
    await waitFor(() => expectUnavailable(6, "Test compiler unavailable"));
    await writeFile(path.join(root, "mode"), "normal");
    await change(7, "<?php repaired;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 7)?.diagnostics).toEqual([]),
    );
    const starts = (await events()).filter((event) => event.type === "start" && event.server);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.memoryLimit).toBe("512M");
    expect(starts[0]?.memoryLimitEnvironment).toBe("512");

    configuration = { compiler: { memoryLimitMegabytes: 768 } };
    await connection.sendNotification("workspace/didChangeConfiguration", { settings: {} });
    await waitFor(async () => {
      const updated = (await events()).filter((event) => event.type === "start" && event.server);
      expect(updated.map((event) => event.memoryLimit)).toEqual(["512M", "768M"]);
      expect(updated.map((event) => event.memoryLimitEnvironment)).toEqual(["512", "768"]);
    });
    await change(8, "<?php still repaired;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 8)?.diagnostics).toEqual([]),
    );
    const allStarts = (await events()).filter((event) => event.type === "start" && event.server);
    expect(allStarts).toHaveLength(2);

    // A real process exit, not an error envelope: the worker fails and the
    // single-shot fallback fails too. Neither may retain version 9's source error.
    await change(9, "<?php bad;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 9)?.diagnostics).toEqual([
        expect.objectContaining({ code: "P1001" }),
      ]),
    );
    await writeFile(path.join(root, "mode"), "out-of-memory");
    await change(10, "<?php repaired;");
    await waitFor(() => expectUnavailable(10, "exhausted its 512 MiB memory limit"));
    const failureMessages = () =>
      messages.filter((message) => message.includes("exhausted its 512 MiB memory limit"));
    const messageCount = failureMessages().length;
    expect(messageCount).toBeGreaterThan(0);
    expect(messages.join("\n")).not.toContain("Secret.php");
    await change(11, "<?php still repaired;");
    await waitFor(() => expectUnavailable(11, "exhausted its 512 MiB memory limit"));
    expect(failureMessages()).toHaveLength(messageCount);
    expect(
      (await events()).filter((event) => event.type === "start" && !event.server),
    ).toHaveLength(2);

    await writeFile(path.join(root, "mode"), "normal");
    await change(12, "<?php repaired;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 12)?.diagnostics).toEqual([]),
    );
    // Recovery resets notification deduplication; the same later failure is new.
    await writeFile(path.join(root, "mode"), "out-of-memory");
    await change(13, "<?php repaired;");
    await waitFor(() => expectUnavailable(13, "exhausted its 512 MiB memory limit"));
    await waitFor(() => expect(failureMessages().length).toBeGreaterThan(messageCount));
    await writeFile(path.join(root, "mode"), "normal");
    await change(14, "<?php repaired;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 14)?.diagnostics).toEqual([]),
    );
    await change(15, "<?php slow-unavailable;");
    await waitFor(async () =>
      expect((await events()).some((event) => event.version === 15)).toBe(true),
    );
    await change(16, "<?php repaired;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 16)?.diagnostics).toEqual([]),
    );
    expect(published.some((item) => item.version === 15)).toBe(false);
    expect(messages.some((message) => message.includes("Document analysis unavailable"))).toBe(
      false,
    );

    const otherUri = pathToFileURL(path.join(root, "b.ppphp")).href;
    const openOther = (version: number) =>
      connection.sendNotification("textDocument/didOpen", {
        textDocument: { uri: otherUri, languageId: "ppphp", version, text: "<?php unavailable;" },
      });
    await openOther(101);
    await waitFor(() => expectUnavailable(101, "Document analysis unavailable"));
    const otherMessages = () =>
      messages.filter((message) => message.includes("Document analysis unavailable")).length;
    const otherCount = otherMessages();
    await change(17, "<?php healthy sibling;");
    await waitFor(() =>
      expect(published.find((item) => item.version === 17)?.diagnostics).toEqual([]),
    );
    await waitFor(() => expect(published.filter((item) => item.version === 101)).toHaveLength(2));
    expect(otherMessages()).toBe(otherCount); // A sibling's success is not this file's recovery.
    await connection.sendNotification("textDocument/didClose", { textDocument: { uri: otherUri } });
    await waitFor(() =>
      expect(
        published.some(
          (item) =>
            item.uri === otherUri && item.version === undefined && item.diagnostics.length === 0,
        ),
      ).toBe(true),
    );
    await openOther(102);
    await waitFor(() => expectUnavailable(102, "Document analysis unavailable"));
    await waitFor(() => expect(otherMessages()).toBeGreaterThan(otherCount));
    await connection.sendRequest("shutdown");
    for (const event of allStarts) expect(() => process.kill(event.pid, 0)).toThrow();
    await connection.sendNotification("exit");
    await closed;
  } finally {
    await cleanup();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
