import * as vscode from "vscode";
import * as assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Real extension-host test. The installed PHP Debug adapter is not modified. */
export async function run(): Promise<void> {
  const root = process.env.PPPHP_SPIKE_PROJECT!;
  const php = process.env.PPPHP_SPIKE_PHP!;
  const extension = process.env.PPPHP_SPIKE_XDEBUG!;
  const bridgePath = process.env.PPPHP_SPIKE_BRIDGE!;
  const resultPath = process.env.PPPHP_SPIKE_RESULT!;
  const results: string[] = [];
  const children: ChildProcess[] = [];
  const disposables: vscode.Disposable[] = [];
  const stops: unknown[] = [];
  let wake: (() => void) | undefined;
  async function nextStop(): Promise<void> {
    if (!stops.length) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("No debugger stop within 15s")), 15000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    assert.ok(stops.shift(), "missing stopped event");
  }
  try {
    disposables.push(
      vscode.debug.registerDebugAdapterTrackerFactory("php", {
        createDebugAdapterTracker() {
          return {
            onDidSendMessage(message) {
              if (message.type === "event" && message.event === "stopped") {
                stops.push(message.body);
                wake?.();
                wake = undefined;
              }
            },
          };
        },
      }),
    );
    const port = await new Promise<number>((resolve) => {
      const socket = createServer();
      socket.listen(0, "127.0.0.1", () => {
        const port = (socket.address() as { port: number }).port;
        socket.close(() => resolve(port));
      });
    });
    const source = vscode.Uri.file(join(root, "src/Quote.ppphp"));
    const document = await vscode.workspace.openTextDocument(source);
    assert.equal(document.languageId, "ppphp");
    await vscode.window.showTextDocument(document);
    const breakpoint = new vscode.SourceBreakpoint(
      new vscode.Location(source, new vscode.Position(8, 0)),
    );
    vscode.debug.addBreakpoints([breakpoint]);
    disposables.push({ dispose: () => vscode.debug.removeBreakpoints([breakpoint]) });
    assert.ok(vscode.debug.breakpoints.includes(breakpoint));
    const started = await vscode.debug.startDebugging(undefined, {
      type: "php",
      request: "launch",
      name: "++PHP debugger spike",
      hostname: "127.0.0.1",
      port,
      stopOnEntry: false,
      log: false,
    });
    assert.equal(started, true);
    const session = vscode.debug.activeDebugSession!;
    assert.ok(session);
    const bridge = spawn(php, [bridgePath, root, String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(bridge);
    const bridgePort = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Bridge startup timeout")), 10000);
      createInterface({ input: bridge.stdout! }).once("line", (line) => {
        clearTimeout(timer);
        resolve(JSON.parse(line).port);
      });
      bridge.once("error", reject);
    });
    const runtime = spawn(php, [
      "-d",
      `zend_extension=${extension}`,
      "-d",
      "xdebug.mode=debug",
      "-d",
      "xdebug.start_with_request=yes",
      "-d",
      "xdebug.client_host=127.0.0.1",
      "-d",
      `xdebug.client_port=${bridgePort}`,
      "-d",
      "xdebug.log_level=0",
      join(root, "build/main.php"),
    ]);
    children.push(runtime);
    let output = "";
    runtime.stdout!.on("data", (part: Buffer) => {
      if (output.length < 1024 * 1024) output += part.toString();
      else runtime.kill();
    });
    const runtimeExit = new Promise<number | null>((resolve) => runtime.once("exit", resolve));
    await nextStop();
    async function frame() {
      const threads = await session.customRequest("threads");
      const threadId = threads.threads[0].id;
      const stack = await session.customRequest("stackTrace", { threadId });
      return { ...stack.stackFrames[0], threadId };
    }
    async function at(file: string, line: number) {
      const top = await frame();
      assert.equal(top.source.path, join(root, "src", file));
      assert.equal(top.line, line);
      results.push(`${file}:${line}`);
      return top;
    }
    let top = await at("Quote.ppphp", 9);
    vscode.debug.removeBreakpoints([breakpoint]);
    async function step(command: string) {
      await session.customRequest(command, { threadId: (await frame()).threadId });
      await nextStop();
    }
    await step("next");
    top = await at("Quote.ppphp", 10);
    const scopes = await session.customRequest("scopes", { frameId: top.id });
    const locals = await session.customRequest("variables", {
      variablesReference: scopes.scopes[0].variablesReference,
    });
    assert.ok(
      locals.variables.some(
        (variable: { name: string; value: string }) =>
          variable.name === "$unitPrice" && variable.value === "100",
      ),
    );
    results.push("native Variables request: $unitPrice=100");
    await step("next");
    await at("Quote.ppphp", 11);
    await step("stepIn");
    top = await at("LegacyTax.php", 11);
    const watch = await session.customRequest("evaluate", {
      expression: "$subtotal",
      frameId: top.id,
      context: "watch",
    });
    assert.equal(watch.result, "300");
    results.push("watch in PHP: $subtotal=300");
    await step("stepOut");
    if ((await frame()).source.path === join(root, "src/LegacyTax.php")) {
      await at("LegacyTax.php", 12);
      results.push("PHP Debug return-value stop before leaving native method");
      await step("stepOut");
    }
    await at("Quote.ppphp", 12);
    const whenStops: number[] = [];
    for (let count = 0; count < 30; count++) {
      top = await frame();
      if (top.line === 17) break;
      whenStops.push(top.line);
      await step("next");
    }
    await at("Quote.ppphp", 17);
    results.push(`when stops (known gap): ${whenStops.join(",")}`);
    await session.customRequest("setExceptionBreakpoints", { filters: ["*"] });
    await step("continue");
    await at("Quote.ppphp", 19);
    await session.customRequest("setExceptionBreakpoints", { filters: [] });
    await session.customRequest("continue", { threadId: (await frame()).threadId });
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      assert.equal(
        await Promise.race([
          runtimeExit,
          new Promise<never>((_, reject) => {
            exitTimer = setTimeout(() => reject(new Error("Runtime exit timeout")), 10000);
          }),
        ]),
        0,
      );
    } finally {
      clearTimeout(exitTimer);
    }
    assert.equal(output, "305\nQuantity must be positive\n");
    results.push("correct output and clean runtime exit");
    writeFileSync(resultPath, JSON.stringify({ status: "PASS", results }, null, 2));
  } catch (error) {
    writeFileSync(
      resultPath,
      JSON.stringify({ status: "FAIL", results, error: String(error) }, null, 2),
    );
    throw error;
  } finally {
    await vscode.debug.stopDebugging();
    for (const disposable of disposables) disposable.dispose();
    for (const child of children) child.kill();
  }
}
