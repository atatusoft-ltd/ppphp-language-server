import { afterEach, describe, expect, it, vi } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagnosticScheduler, diagnosticSnapshot } from "../src/diagnostic-scheduler.js";

afterEach(() => vi.useRealTimers());

describe("live diagnostic scheduling", () => {
  it("debounces edits, invalidates results immediately and never overlaps rounds", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    let current: (() => boolean) | undefined;
    let signal: AbortSignal | undefined;
    const run = vi.fn(async (isCurrent: () => boolean, abortSignal: AbortSignal) => {
      current = isCurrent;
      signal = abortSignal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const scheduler = new DiagnosticScheduler(run, vi.fn());
    scheduler.schedule(undefined, "first");
    await vi.advanceTimersByTimeAsync(25);
    scheduler.schedule(undefined, "edited");
    await vi.advanceTimersByTimeAsync(49);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(current?.()).toBe(true);
    expect(run.mock.calls[0]?.[1].aborted).toBe(false);
    scheduler.schedule(undefined, "newest");
    expect(current?.()).toBe(false);
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(run).toHaveBeenCalledTimes(1);
    release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(expect.any(Function), expect.any(AbortSignal), "newest");
    scheduler.dispose();
    expect(current?.()).toBe(false);
    expect(signal?.aborted).toBe(true);
    release?.();
  });

  it("prioritizes the edited buffer without mutating or dropping any overlay", () => {
    const first = TextDocument.create("file:///a.ppphp", "ppphp", 1, "original");
    const edited = TextDocument.create("file:///b.ppphp", "ppphp", 2, "unsaved");
    const php = TextDocument.create("file:///c.php", "php", 3, "context");
    const documents = [first, edited, php];
    const snapshot = diagnosticSnapshot(documents, edited.uri);
    expect(snapshot.map((document) => document.uri)).toEqual([edited.uri, first.uri, php.uri]);
    TextDocument.update(edited, [{ text: "changed again" }], 4);
    expect(snapshot[0]?.getText()).toBe("unsaved");
    expect(snapshot[0]?.version).toBe(2);
    expect(documents[0]).toBe(first);
    expect(diagnosticSnapshot(documents).map((document) => document.uri)).toEqual(
      documents.map((document) => document.uri),
    );
  });

  it("retains the edited target when a watcher or configuration event also refreshes diagnostics", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = new DiagnosticScheduler(run, vi.fn());
    scheduler.schedule(undefined, "edited");
    scheduler.schedule(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledWith(expect.any(Function), expect.any(AbortSignal), "edited");
    scheduler.dispose();
  });

  it("does not report errors from cancelled generations", async () => {
    vi.useFakeTimers();
    const report = vi.fn();
    let reject: (error: Error) => void = () => undefined;
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(undefined);
    const scheduler = new DiagnosticScheduler(run, report);
    scheduler.schedule(0);
    await vi.advanceTimersByTimeAsync(0);
    scheduler.schedule();
    reject(new Error("obsolete process"));
    await vi.advanceTimersByTimeAsync(50);
    expect(report).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it("cancels pending work on shutdown and recovers from failures", async () => {
    vi.useFakeTimers();
    const error = new Error("test failure");
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const report = vi.fn();
    const scheduler = new DiagnosticScheduler(run, report);
    scheduler.schedule(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith(error);
    scheduler.schedule(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.schedule();
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
