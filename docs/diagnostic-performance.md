# Diagnostic latency

The interaction target is a current diagnostic update within 200 ms of the last edit, including clearing an error after a repair. This is a target, not an achieved end-to-end guarantee. Compiler-core diagnostics must remain complete under the declared coverage contract; a successful syntax check alone cannot clear semantic diagnostics.

## Where time goes

The path is editor change notification, debounce, any remaining obsolete work, settings lookup, compiler execution, diagnostic publication, and IDE rendering. The previous scheduler imposed a 300 ms debounce before any compiler work and checked documents in open order. New edits invalidated results but did not terminate obsolete subprocesses.

The shared server now:

- Coalesces edit bursts for 50 ms, retaining immediate save/configuration refreshes.
- Discards obsolete retained-worker responses, keeping the compiler's reusable state alive, and sends only the latest pending snapshot afterward. Older compilers use single-shot subprocesses, which are terminated on invalidation and reaped before the next round.
- Checks the most recently edited document first, retaining the complete immutable overlay snapshot and subsequent checks of other open documents.
- Suppresses cancelled-generation diagnostics and warnings. It never clears diagnostics merely because work was cancelled.
- Replaces obsolete source findings with a versioned `analysis-unavailable` tooling warning when the current check fails. That warning is not a syntax error or a successful check. A successful current check replaces it; repeated failures update its document version without flooding notifications.

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

The compiler task independently traced the valid-source cost to declaration-context preparation and semantic analysis. Reusing a process alone still left those phases above the interaction budget in its initial profile. Compiler-owned reuse must preserve project/dependency/overlay freshness and the endpoint's no-write contract; a persistent transport alone is not a sufficient fix.

## Retained-worker integration

Later on 8 September 2026, the compiler's committed retained transport and immutable metadata/platform reuse were tested through the same ten-buffer LSP path. The compiler build-identity check was included. On the local PHP 8.5 runtime, with the target opened last, the first valid publication took 1,187 ms. Three subsequent deletion/repair pairs produced:

| Update                      | Edit to matching-version publication |
| --------------------------- | ------------------------------------ |
| Missing semicolon (`P1001`) | 155–214 ms                           |
| Repaired, zero diagnostics  | 263–321 ms                           |

The target was published first in all six rounds. These timings include the 50 ms debounce and any remaining background diagnostic request. They do not include IDE rendering, and are observations rather than controlled speedup ratios. Repairs are substantially faster than the earlier single-shot samples, but **the 200 ms target remains unmet reliably**, particularly for cold execution. Recycling or replacing a worker reintroduces cold cost; an older compiler remains correct through single-shot fallback without receiving the warm-worker speedup.

The worker-ready frame is transport readiness, not prewarming. The client deliberately preserves semantic coverage and dependency overlays instead of returning a quick syntax-only success that could erase real errors. The compiler rechecks configuration, sources, dependencies and overlays on every request; the client retains neither semantic models nor previous results as a substitute for analysis. See [the compiler transport contract](https://github.com/atatusoft-ltd/ppphp-src/blob/develop/docs/editor-protocol.md) for lifecycle and ownership details.

## Regression and follow-up checks

Deterministic tests cover edit coalescing, immediate generation invalidation, process cancellation, shutdown, single-flight behavior while cancelled work finishes, latest-target priority, immutable overlays, background refreshes retaining priority, and suppression of stale errors. Real subprocess tests cover cancellation before launch, cancellation in flight, completed output unaffected by later cancellation, fragmented UTF-8/CRLF framing, handshake and response validation, bounded startup/request failure, recycling, installation changes, fallback backoff and retained-worker limits. An actual stdio LSP test exercises valid → error → repaired transitions, skips superseded revisions without restarting the worker, replaces obsolete errors after both worker and single-shot failure, tests repeated failure and recovery, keeps sibling-document failure states independent, and verifies shutdown reaping.

## Failed analysis is a separate state

The September 10 investigation reproduced an incomplete constructor producing a valid syntax diagnostic, followed by repaired source exhausting the installed compiler's memory during Composer dependency analysis. Both the retained worker and its single-shot fallback failed. The server previously kept the incomplete version's diagnostic, and an acceptance test explicitly required that behavior. It then mistook the PHP fatal-error output for evidence of an unsupported compiler protocol. This was a state-model and test-contract defect, not a missing parser special case.

The shared server now distinguishes successful findings, current analysis failure, and cancelled/obsolete work. Fatal memory exhaustion, termination, abnormal exit and output overflow are classified in the common compiler-process layer, so navigation and semantic-token requests benefit too. Only bounded, sanitized failure descriptions are displayed; raw PHP stacks and source text are not copied into notifications. Valid diagnostic envelopes with normal finding exit codes remain accepted, and envelope/document/coverage validation remains strict.

This handling does not fix the compiler's memory use. Compiler memory optimizations must be distributed in a separately authorized release and verified against the compiler actually selected by the editor. Project-local Composer installations take precedence over a global checkout. Do not silently change a project's pin, replace its compiler with a different checkout, increase its memory ceiling, or claim that a successful current-checkout test proves the installed release is fixed. The latency target above remains unchanged and unproven as a general guarantee.

For subsequent compiler improvements, repeat the deletion/repair measurement with the edited file opened both first and last. Include body/type errors, dependent open documents, rapid edits during analysis, and cold versus warm execution. Record both compiler duration and matching-version LSP publication; separately verify the installed IDE's display latency. Do not infer a 200 ms semantic guarantee from fast syntax-error results.
