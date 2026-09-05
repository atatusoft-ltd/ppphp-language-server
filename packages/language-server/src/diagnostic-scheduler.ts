/** One bounded analysis round at a time; any document edit invalidates the whole overlay snapshot. */
export class DiagnosticScheduler {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private ready = false;

  constructor(
    private readonly analyze: (isCurrent: () => boolean) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  schedule(delay = 300): void {
    this.generation++;
    this.ready = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.ready = true;
      void this.flush();
    }, delay);
  }

  dispose(): void {
    this.generation++;
    this.ready = false;
    clearTimeout(this.timer);
  }

  private async flush(): Promise<void> {
    if (this.running || !this.ready) return;
    this.running = true;
    this.ready = false;
    const generation = this.generation;
    try {
      await this.analyze(() => generation === this.generation);
    } catch (error) {
      if (generation === this.generation) this.onError(error);
    } finally {
      this.running = false;
      if (this.ready) void this.flush();
    }
  }
}
