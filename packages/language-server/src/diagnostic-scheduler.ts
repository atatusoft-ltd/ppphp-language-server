import { TextDocument } from "vscode-languageserver-textdocument";

/** One bounded analysis round at a time; any document edit invalidates the whole overlay snapshot. */
export class DiagnosticScheduler {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private ready = false;
  private controller: AbortController | undefined;
  private priorityUri: string | undefined;

  constructor(
    private readonly analyze: (
      isCurrent: () => boolean,
      signal: AbortSignal,
      priorityUri?: string,
    ) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  schedule(delay = 50, priorityUri?: string): void {
    this.generation++;
    this.controller?.abort();
    if (priorityUri !== undefined) this.priorityUri = priorityUri;
    this.ready = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.ready = true;
      void this.flush();
    }, delay);
  }

  dispose(): void {
    this.generation++;
    this.controller?.abort();
    this.ready = false;
    clearTimeout(this.timer);
  }

  private async flush(): Promise<void> {
    if (this.running || !this.ready) return;
    this.running = true;
    this.ready = false;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.analyze(() => generation === this.generation, controller.signal, this.priorityUri);
    } catch (error) {
      if (generation === this.generation) this.onError(error);
    } finally {
      this.controller = undefined;
      this.running = false;
      if (this.ready) void this.flush();
    }
  }
}

/** Keep every overlay, but publish the edited document before background consumers. */
export function diagnosticSnapshot(
  documents: readonly TextDocument[],
  priorityUri?: string,
): TextDocument[] {
  return documents
    .map((document) =>
      TextDocument.create(document.uri, document.languageId, document.version, document.getText()),
    )
    .sort((left, right) => Number(right.uri === priorityUri) - Number(left.uri === priorityUri));
}
