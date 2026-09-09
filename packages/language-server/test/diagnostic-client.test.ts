import { mkdtemp, copyFile, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticClient } from "../src/diagnostic-client.js";

const roots: string[] = [];
const clients: DiagnosticClient[] = [];
const fixture = fileURLToPath(new URL("./fixtures/diagnostic-worker.php", import.meta.url));
async function project(mode = "normal") {
  const root = await mkdtemp(path.join(os.tmpdir(), "ppphp-worker-test-"));
  roots.push(root);
  const compiler = path.join(root, "compiler.php");
  await copyFile(fixture, compiler);
  await writeFile(path.join(root, "mode"), mode);
  return { root, compiler };
}
function client() {
  const value = new DiagnosticClient();
  clients.push(value);
  return value;
}
async function log(root: string) {
  return (await readFile(path.join(root, "transport.log"), "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as {
          pid: number;
          type: string;
          server?: boolean;
          id?: number;
          version?: number;
          memoryLimit?: string;
        },
    );
}
function run(
  value: DiagnosticClient,
  target: Awaited<ReturnType<typeof project>>,
  version = 1,
  signal?: AbortSignal,
  timeout = 3000,
  memoryLimitMegabytes?: number,
) {
  return value.execute(
    target.compiler,
    ["editor:diagnostics", "--working-directory", target.root, "--format=json"],
    target.root,
    timeout,
    JSON.stringify({ version: 1, document: { path: "a.ppphp", version, contents: "<?php bad;" } }),
    signal,
    memoryLimitMegabytes,
  );
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((value) => value.reset()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("retained diagnostic client", () => {
  it("restarts retained workers when the memory limit changes", async () => {
    const target = await project();
    const value = client();
    await run(value, target);
    await run(value, target, 2, undefined, 3000, 768);
    await run(value, target, 3, undefined, 3000, 768);
    expect(
      (await log(target.root))
        .filter((event) => event.type === "start")
        .map((event) => event.memoryLimit),
    ).toEqual(["512M", "768M"]);
  });

  it("preserves a custom limit in the single-shot fallback", async () => {
    const target = await project("unsupported");
    expect(
      JSON.parse((await run(client(), target, 1, undefined, 3000, 1024)).stdout).document.version,
    ).toBe(1);
    expect(
      (await log(target.root))
        .filter((event) => event.type === "start")
        .map((event) => event.memoryLimit),
    ).toEqual(["1024M", "1024M"]);
  });
  it("validates fragmented UTF-8/CRLF framing and reuses one serial worker", async () => {
    const target = await project("fragmented");
    const value = client();
    for (const version of [1, 2, 3]) {
      const result = await run(value, target, version);
      expect(result.failure).toBeUndefined();
      expect(JSON.parse(result.stdout).document.version).toBe(version);
      expect(JSON.parse(result.stdout).diagnostics[0].message).toBe("Bad syntax 🐘");
    }
    const events = await log(target.root);
    expect(events.filter((event) => event.type === "start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "request").map((event) => event.id)).toEqual([
      1, 2, 3,
    ]);
  });

  it.each([
    "unsupported",
    "bad-version",
    "bad-capabilities",
    "bad-identity",
    "wrong-id",
    "eof",
    "truncated",
    "invalid-utf8",
    "transport-error",
    "extra-frame",
    "oversized",
    "stderr-overflow",
  ])("falls back safely after %s and does not repeatedly probe the failed worker", async (mode) => {
    const target = await project(mode);
    const value = client();
    expect(JSON.parse((await run(value, target)).stdout).document.version).toBe(1);
    expect(JSON.parse((await run(value, target, 2)).stdout).document.version).toBe(2);
    const events = await log(target.root);
    expect(events.filter((event) => event.type === "start" && event.server)).toHaveLength(1);
    expect(events.filter((event) => event.type === "start" && !event.server)).toHaveLength(2);
  });

  it.each(["startup-timeout", "request-timeout"])(
    "bounds %s then reaps the worker before fallback",
    async (mode) => {
      const target = await project(mode);
      const result = await run(client(), target, 1, undefined, 500);
      expect(result.failure).toBeUndefined();
      expect(JSON.parse(result.stdout).document.version).toBe(1);
      const pid = (await log(target.root)).find((event) => event.server)!.pid;
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );

  it("discards a superseded response without killing or cold-restarting a healthy worker", async () => {
    const target = await project("slow");
    const value = client();
    const controller = new AbortController();
    const obsolete = run(value, target, 1, controller.signal);
    await vi.waitFor(async () =>
      expect((await log(target.root)).some((event) => event.type === "request")).toBe(true),
    );
    controller.abort();
    expect((await obsolete).cancelled).toBe(true);
    expect(JSON.parse((await run(value, target, 4)).stdout).document.version).toBe(4);
    const events = await log(target.root);
    expect(events.filter((event) => event.type === "start")).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "request").map((event) => event.version),
    ).toEqual([1, 4]);
  });

  it("recycles and restarts with fresh IDs without losing the final normal result", async () => {
    const target = await project("recycle");
    const value = client();
    for (const version of [1, 2, 3])
      expect(JSON.parse((await run(value, target, version)).stdout).document.version).toBe(version);
    const events = await log(target.root);
    expect(events.filter((event) => event.type === "start")).toHaveLength(2);
    expect(events.filter((event) => event.type === "request").map((event) => event.id)).toEqual([
      1, 2, 1,
    ]);
  });

  it.each(["installation-changed", "installation-loop"])(
    "bounds restart after %s",
    async (mode) => {
      const target = await project(mode);
      expect(JSON.parse((await run(client(), target, 7)).stdout).document.version).toBe(7);
      const events = await log(target.root);
      expect(events.filter((event) => event.type === "start" && event.server)).toHaveLength(2);
      expect(events.filter((event) => event.type === "start" && !event.server)).toHaveLength(
        mode === "installation-loop" ? 1 : 0,
      );
    },
  );

  it("does not spawn for an already superseded request", async () => {
    const target = await project();
    expect((await run(client(), target, 1, AbortSignal.abort())).cancelled).toBe(true);
    expect(await log(target.root)).toEqual([]);
  });

  it("restarts for compiler replacement, settings changes, and explicit configuration reset", async () => {
    const target = await project();
    const value = client();
    await run(value, target);
    await appendFile(target.compiler, "\n// replaced installation\n");
    await run(value, target, 2);
    await run(value, target, 3, undefined, 4000);
    await value.reset();
    await run(value, target, 4, undefined, 4000);
    expect((await log(target.root)).filter((event) => event.type === "start")).toHaveLength(4);
  });

  it("keeps project workers isolated and bounds the retained worker count", async () => {
    const value = client();
    const targets = await Promise.all(Array.from({ length: 5 }, () => project()));
    for (const target of targets) await run(value, target);
    await run(value, targets[4]!, 2);
    await run(value, targets[0]!, 2);
    expect((await log(targets[4]!.root)).filter((event) => event.type === "start")).toHaveLength(1);
    expect((await log(targets[0]!.root)).filter((event) => event.type === "start")).toHaveLength(2);
  });

  it("rejects concurrent callers and cancels reset work without starting fallback", async () => {
    const target = await project("slow");
    const value = client();
    const active = run(value, target);
    expect((await run(value, target, 2)).failure).toContain("serially");
    await vi.waitFor(async () =>
      expect((await log(target.root)).some((event) => event.type === "request")).toBe(true),
    );
    await value.reset();
    expect((await active).cancelled).toBe(true);
    expect((await log(target.root)).filter((event) => event.type === "start")).toHaveLength(1);
  });
});
