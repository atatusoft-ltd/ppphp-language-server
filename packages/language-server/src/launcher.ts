import { handleComposerNamespaceCommand } from "./composer-namespace.js";
import { runRenameCommand } from "./rename-command.js";

if (process.argv[2] === "--infer-composer-namespace") {
  void handleComposerNamespaceCommand([{ directoryUri: process.argv[3] }])
    .then((resolution) => process.stdout.write(`${JSON.stringify(resolution)}\n`))
    .catch(() => {
      process.exitCode = 1;
    });
} else if (process.argv[2] === "--rename") {
  void runRenameCommand().then((response) => process.stdout.write(`${JSON.stringify(response)}\n`));
} else {
  void import("./node.js");
}
