import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticScheduler } from "../src/diagnostic-scheduler.js";

afterEach(() => vi.useRealTimers());

describe("live diagnostic scheduling", () => {
  it("debounces edits, invalidates results immediately and never overlaps rounds", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    let current: (() => boolean) | undefined;
    const run = vi.fn(async (isCurrent: () => boolean) => {
      current = isCurrent;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const scheduler = new DiagnosticScheduler(run, vi.fn());
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(200);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(299);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(current?.()).toBe(true);
    scheduler.schedule();
    expect(current?.()).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
    expect(current?.()).toBe(false);
    release?.();
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
