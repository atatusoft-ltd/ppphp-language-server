import { handleComposerNamespaceCommand } from "./composer-namespace.js";

if (process.argv[2] === "--infer-composer-namespace") {
  void handleComposerNamespaceCommand([{ directoryUri: process.argv[3] }])
    .then((resolution) => process.stdout.write(`${JSON.stringify(resolution)}\n`))
    .catch(() => {
      process.exitCode = 1;
    });
} else {
  void import("./node.js");
}
