# Diagnostic latency

The interaction target is a current diagnostic update within 200 ms of the last edit, including clearing an error after a repair. This is a target, not an achieved end-to-end guarantee. Compiler-core diagnostics must remain complete under the declared coverage contract; a successful syntax check alone cannot clear semantic diagnostics.

## Where time goes

The path is editor change notification, debounce, any remaining obsolete work, settings lookup, compiler execution, diagnostic publication, and IDE rendering. The previous scheduler imposed a 300 ms debounce before any compiler work and checked documents in open order. New edits invalidated results but did not terminate obsolete subprocesses.

The shared server now:

- Coalesces edit bursts for 50 ms, retaining immediate save/configuration refreshes.
- Cancels the obsolete compiler process immediately on snapshot invalidation and waits for process completion before starting another round.
- Checks the most recently edited document first, retaining the complete immutable overlay snapshot and subsequent checks of other open documents.
- Suppresses cancelled-generation diagnostics and warnings. It never clears diagnostics merely because work was cancelled.

This applies to both editor adapters. It does not create another parser, make analysis file-local, or skip dependency-sensitive checks.

## Local measurements

On 8 September 2026, a read-only benchmark used the installed compiler and the mixed MVP showcase with ten open app buffers. It removed and restored the semicolon after `return "ERROR: " . $error->getMessage();` in `DemoRunner.ppphp` using unsaved requests only. No example source was modified. Timings are observations from one development machine under concurrent development load, not CI limits or cross-machine guarantees.

Four direct `editor:diagnostics` subprocess samples, including startup, JSON transport and compiler work:

| Target buffer               | Observed duration |
| --------------------------- | ----------------- |
| Missing semicolon (`P1001`) | 113–122 ms        |
| Repaired, zero diagnostics  | 972–1,012 ms      |

A separate LSP client launched the bundled server over stdio, opened all ten files, sent full-buffer `didChange` notifications, and measured until `publishDiagnostics` for the matching target revision. It alternated deletion and repair three times while background checks could be in flight. This measures server publication, **not** PhpStorm paint time or its settings-request overhead.

With the target first among diagnostic documents, the previous packaged server and updated bundle produced:

| Update            | Previous bundle | Updated bundle |
| ----------------- | --------------- | -------------- |
| Missing semicolon | 806–1,325 ms    | 186–226 ms     |
| Repaired          | 1,673–1,724 ms  | 1,123–1,528 ms |

These sequential samples are not controlled speedup ratios. Opening the target last confirmed the scheduling issue: the previous server published other documents first, whereas the updated server published the target first in every observed round. A later run under heavier concurrent load was much slower even with the update (470–1,202 ms for syntax and 1,959–7,446 ms for repairs). The 200 ms target is therefore **not reliably met**, and neither target priority nor a shorter timer eliminates compiler cost or host contention.

The compiler task independently traced the valid-source cost to declaration-context preparation and semantic analysis. Reusing a process alone still left those phases above the interaction budget in its local profile. Compiler-owned reuse must use exact project/dependency/overlay identities and preserve the endpoint's no-write contract; a persistent transport alone is not a sufficient fix.

## Regression and follow-up checks

Deterministic tests cover edit coalescing, immediate generation invalidation, process cancellation, shutdown, single-flight behavior while cancelled work finishes, latest-target priority, immutable overlays, background refreshes retaining priority, and suppression of stale errors. Real subprocess tests cover cancellation before launch, cancellation in flight, and completed output unaffected by later cancellation.

For subsequent compiler improvements, repeat the deletion/repair measurement with the edited file opened both first and last. Include body/type errors, dependent open documents, rapid edits during analysis, and cold versus warm execution. Record both compiler duration and matching-version LSP publication; separately verify the installed IDE's display latency. Do not infer a 200 ms semantic guarantee from fast syntax-error results.
