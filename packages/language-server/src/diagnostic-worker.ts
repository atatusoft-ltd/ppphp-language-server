import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { CompilerInvocation } from "./compiler-process.js";

const MAX_FRAME = 16 * 1024 * 1024 + 1024;
const MAX_RESPONSE = 4 * 1024 * 1024 + 1024;
const MAX_STDERR = 64 * 1024;
const IDLE_MILLISECONDS = 60_000;

interface Pending {
  id: number;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CompilerInstallationChanged extends Error {}

/** One serial NDJSON connection. The scheduler, not this transport, owns coalescing. */
export class DiagnosticWorker {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<void>;
  private readonly ready: Promise<string>;
  private pending: Pending | undefined;
  private buffer = Buffer.alloc(0);
  private stderrBytes = 0;
  private nextId = 1;
  private maxFrame = MAX_FRAME;
  private maxResponse = MAX_RESPONSE;
  private maxRequests = 1000;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private stopping: Promise<void> | undefined;
  private failure: Error | undefined;
  private handshaken = false;
  ended = false;

  constructor(
    invocation: CompilerInvocation,
    cwd: string,
    environment: NodeJS.ProcessEnv,
    timeout: number,
  ) {
    this.child = spawn(invocation.command, [...invocation.arguments, "--server"], {
      cwd,
      env: environment,
      stdio: "pipe",
      windowsHide: true,
    });
    this.closed = new Promise((resolve) => {
      this.child.once("close", () => {
        this.ended = true;
        clearTimeout(this.idle);
        this.fail(new Error("The diagnostic worker closed before completing its request."));
        resolve();
      });
    });
    this.ready = this.waitFor(0, timeout);
    // A worker can fail while idle; never leave a rejected handshake unobserved.
    void this.ready.catch(() => undefined);
    this.child.on("error", () =>
      this.fail(new Error("The diagnostic worker could not be started.")),
    );
    this.child.stdin.on("error", () => this.fail(new Error("The diagnostic worker input closed.")));
    this.child.stdout.on("data", (chunk: Buffer) => this.read(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > MAX_STDERR)
        this.fail(new Error("The diagnostic worker exceeded its stderr limit."));
    });
  }

  async request(input: string, timeout: number, signal?: AbortSignal): Promise<string | undefined> {
    await this.ready;
    if (this.failure) throw this.failure;
    if (signal?.aborted) return undefined;
    if (this.pending) throw new Error("Diagnostic worker requests must be serial.");
    if (this.ended) throw new Error("The diagnostic worker needs recycling.");
    clearTimeout(this.idle);
    const id = this.nextId++;
    const frame =
      JSON.stringify({ version: 1, id, method: "diagnostics", params: JSON.parse(input) }) + "\n";
    if (Buffer.byteLength(frame) > this.maxFrame)
      throw new Error("The diagnostic request exceeds the worker frame limit.");
    const response = this.waitFor(id, timeout);
    this.child.stdin.write(frame, (error) => {
      if (error) this.fail(new Error("The diagnostic worker request could not be written."));
    });
    // Client-discard cancellation: finish the bounded in-flight request, keeping
    // the worker warm, before the scheduler sends its newest pending snapshot.
    const result = await response;
    if (this.failure) throw this.failure;
    return signal?.aborted ? undefined : result;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.ended = true;
    clearTimeout(this.idle);
    this.child.stdin.end();
    const kill = setTimeout(() => this.child.kill("SIGKILL"), 250);
    kill.unref();
    this.stopping = this.closed.finally(() => clearTimeout(kill));
    return this.stopping;
  }

  private waitFor(id: number, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error("The diagnostic worker exceeded its editor timeout.")),
        timeout,
      );
      this.pending = { id, resolve, reject, timer };
    });
  }

  private fail(error: Error): void {
    if (!this.failure) this.failure = error;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    if (!this.ended) void this.stop();
  }

  private read(chunk: Buffer): void {
    if (this.failure) return;
    if (this.buffer.length + chunk.length > this.maxResponse) {
      this.fail(new Error("The diagnostic worker exceeded its response frame limit."));
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) !== -1) {
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      try {
        const frame: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
        this.accept(frame);
      } catch {
        this.fail(new Error("The diagnostic worker returned an unsupported or malformed frame."));
        return;
      }
    }
    if (!this.pending && this.buffer.length)
      this.fail(new Error("The diagnostic worker sent unsolicited output."));
  }

  private accept(value: unknown): void {
    const frame = record(value);
    const pending = this.pending;
    if (!frame || frame.version !== 1 || !pending) throw new Error("Unexpected worker frame.");
    let result = "";
    if (!this.handshaken) {
      const capabilities = record(frame.capabilities);
      if (
        frame.type !== "ready" ||
        typeof frame.compilerVersion !== "string" ||
        !frame.compilerVersion ||
        frame.compilerVersion.length > 256 ||
        typeof frame.compilerBuildIdentity !== "string" ||
        !frame.compilerBuildIdentity.startsWith("sha256:") ||
        frame.compilerBuildIdentity.length <= 7 ||
        frame.compilerBuildIdentity.length > 256 ||
        !capabilities ||
        capabilities.diagnosticsVersion !== 1 ||
        capabilities.maxInFlight !== 1 ||
        capabilities.cancellation !== "client-discard" ||
        capabilities.singleShotFallback !== true ||
        !boundedInteger(capabilities.maxFrameBytes, MAX_FRAME) ||
        !boundedInteger(capabilities.maxResponseBytes, MAX_RESPONSE) ||
        !boundedInteger(capabilities.maxRequests, 1000)
      )
        throw new Error("Unsupported worker capabilities.");
      this.maxFrame = capabilities.maxFrameBytes;
      this.maxResponse = capabilities.maxResponseBytes;
      this.maxRequests = capabilities.maxRequests;
      this.handshaken = true;
    } else {
      if (
        frame.id === pending.id &&
        frame.recycle === true &&
        frame.result === undefined &&
        record(frame.error)?.code === "installation-changed"
      ) {
        this.fail(new CompilerInstallationChanged("The compiler installation changed."));
        return;
      }
      if (
        frame.id !== pending.id ||
        typeof frame.recycle !== "boolean" ||
        frame.error ||
        !record(frame.result)
      ) {
        throw new Error("Mismatched worker response.");
      }
      result = JSON.stringify(frame.result);
      if (frame.recycle || pending.id >= this.maxRequests) this.ended = true;
    }
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve(result);
    if (this.ended) void this.stop();
    else {
      this.idle = setTimeout(() => void this.stop(), IDLE_MILLISECONDS);
      this.idle.unref();
    }
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedInteger(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= limit;
}
