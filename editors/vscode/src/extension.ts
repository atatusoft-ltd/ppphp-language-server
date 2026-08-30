import path from "node:path";
import type { ExtensionContext } from "vscode";
import { workspace } from "vscode";
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join("dist", "server.cjs"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "ppphp", scheme: "file" }],
    synchronize: {
      configurationSection: "ppphp",
      fileEvents: workspace.createFileSystemWatcher("**/*.ppp"),
    },
  };

  client = new LanguageClient(
    "ppphpLanguageServer",
    "++PHP Language Server",
    serverOptions,
    clientOptions,
  );
  context.subscriptions.push(client);
  void client.start();
}

export async function deactivate(): Promise<void> {
  if (client) await client.stop();
}
