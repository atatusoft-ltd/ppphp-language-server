import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";
import {
  ConfigurationRequest,
  DidOpenTextDocumentNotification,
  DocumentSymbolRequest,
  ExitNotification,
  HoverRequest,
  InitializeRequest,
  InitializedNotification,
  RegistrationRequest,
  SemanticTokensRequest,
  ShutdownRequest,
  ShowMessageRequest,
  StreamMessageReader,
  StreamMessageWriter,
  createProtocolConnection,
} from "vscode-languageserver/node";

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("LSP smoke request timed out")), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

it("serves the Zed stdio/configuration contract with the shared server", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ppphp zed stdio-"));
  try {
    const bundle = path.join(root, "server.cjs");
    await build({
      entryPoints: [fileURLToPath(new URL("../src/launcher.ts", import.meta.url))],
      outfile: bundle,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      logLevel: "silent",
    });
    const child = spawn(process.execPath, [bundle, "--stdio"], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PPPHP_COMPILER_PATH: path.join(root, "missing-compiler"),
        PPPHP_PHP_PATH: path.join(root, "missing-php"),
      },
    });
    const exited = once(child, "exit");
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-65536);
    });
    const connection = createProtocolConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    const sections: string[] = [];
    // This is the object returned by the Zed adapter's workspace configuration hook.
    const settings = {
      ppphp: {
        compiler: { path: path.join(root, "missing-compiler") },
        diagnostics: { compiler: { enabled: false, timeoutMilliseconds: 500 } },
      },
    };
    connection.onRequest(ConfigurationRequest.type, ({ items }) =>
      items.map((item) => {
        sections.push(item.section ?? "");
        return item.section === "ppphp" ? settings.ppphp : null;
      }),
    );
    connection.onRequest(RegistrationRequest.type, () => undefined);
    connection.onRequest(ShowMessageRequest.type, () => null);
    connection.listen();
    let stage = "initialize";
    try {
      const initialized = await bounded(
        connection.sendRequest(InitializeRequest.type, {
          processId: null,
          rootUri: pathToFileURL(root).href,
          capabilities: {
            workspace: {
              configuration: true,
              workspaceEdit: { documentChanges: true, resourceOperations: ["rename"] },
            },
          },
        }),
      );
      expect(initialized.serverInfo?.name).toBe("++PHP Language Server");
      expect(initialized.capabilities.semanticTokensProvider).toBeDefined();
      expect(initialized.capabilities.documentFormattingProvider).toBeUndefined();
      await connection.sendNotification(InitializedNotification.type, {});
      const uri = pathToFileURL(path.join(root, "example.ppphp")).href;
      await connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri,
          languageId: "ppphp",
          version: 1,
          text: "<?php\nfunction load(): void throws Failure {\n    string $label = 'value';\n}\n",
        },
      });
      stage = "hover";
      const hover = await bounded(
        connection.sendRequest(HoverRequest.type, {
          textDocument: { uri },
          position: { line: 1, character: 25 },
        }),
      );
      expect(JSON.stringify(hover)).toContain("throws");
      stage = "symbols";
      const symbols = await bounded(
        connection.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri } }),
      );
      expect(symbols?.some((symbol) => symbol.name === "load")).toBe(true);
      stage = "tokens";
      const tokens = await bounded(
        connection.sendRequest(SemanticTokensRequest.type, { textDocument: { uri } }),
      );
      // The canonical ++PHP fallback remains usable without an installed compiler.
      expect(tokens?.data.length).toBeGreaterThan(0);
      expect(sections).toContain("ppphp");
      stage = "shutdown";
      await bounded(connection.sendRequest(ShutdownRequest.type));
      await connection.sendNotification(ExitNotification.type);
      stage = "exit";
      const [exitCode] = await bounded(exited);
      expect(exitCode, stderr).toBe(0);
    } catch (error) {
      throw new Error("LSP smoke failed during " + stage + ": " + stderr, { cause: error });
    } finally {
      connection.dispose();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await bounded(exited);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
