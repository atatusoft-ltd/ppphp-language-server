# September 10: obsolete diagnostics and the Marketplace runtime failure

Imagine repairing a constructor and still seeing “Expected a variable before `}`.” The compiler had rejected an earlier incomplete edit. After the repair, it ran out of memory while examining dependencies. The editor then kept the earlier error. Separately, Marketplace found a Java crash while PhpStorm read Composer configuration. Both involve Composer, but they are different failures.

## Findings and ownership

### Compiler memory and distribution

The example project's installed compiler was pinned to `2026.3.1-rc-2`. At an explicit 512 MiB limit, the repaired document exhausted memory in dependency parsing, in both retained-worker and single-shot calls. The current compiler checkout accepted the same saved bytes. The syntax itself was valid; changing it would have hidden the symptom.

Compiler commits `c210718`, `54a1ef8` and `21adb0d` reduce retained token/AST data and stop following unrelated dependency implementation references. They are on compiler `main`, but were not in a subsequently published release at the time of this investigation. A release/distribution gap remains. Do not treat a working development checkout as proof that a user's pinned installation contains these fixes. The compiler task owns that release and its memory/performance evidence; this tooling change does not publish or select a different compiler.

### Shared language-server state and process reporting

The language server deliberately skipped publication when analysis failed. Its acceptance test explicitly expected the previous version's diagnostic to remain. It also treated malformed fatal-error output as evidence that the compiler needed a protocol upgrade. The defect therefore existed in both implementation and the definition of expected behavior.

The corrected contract is:

- Successful current analysis publishes its findings, including an empty list when appropriate.
- Failed current analysis replaces obsolete findings with an `analysis-unavailable` tooling warning. It says the document has not been verified and preserves the actual process failure.
- Cancelled or superseded results publish nothing.
- Recovery removes the failure warning. Repeated failures update its version without repeating notifications; another document's success does not reset this document's failure state.

The shared subprocess layer classifies memory exhaustion, abnormal exits, termination and output overflow. It does not publish raw fatal-error stacks, private paths or source bytes. Valid compiler finding envelopes remain accepted; document identity and coverage checks remain strict. The stdio acceptance test now covers worker failure, single-shot fallback failure, repeated failure, recovery, sibling documents, cancellation and stale results. These rules apply to all clients of the shared server, not just PhpStorm.

### Native PhpStorm Composer race

The [Marketplace report](https://downloads.marketplace.jetbrains.com/verifications/34151/5804681/sarif.json) points to [TeamCity run 380380](https://intellij-plugins-performance.teamcity.com/buildConfiguration/PluginPlatformTests_ExternalPluginsCheckerTests/380380?guest=1&buildTab=artifacts). The submitted plugin was `2026.3.3`; the host was PhpStorm `263.3889.75`.

Binary verification reported compatibility with 19 deprecated API usages. The separate IDE run reported a null-pointer exception at `ComposerConfigListener.getNewData:47`. Its full log attributes the exception to the native PHP plugin. The paired without-plugin run did not report this exception. That one control run is not proof of absence, and stack-frame ownership alone would not prove ++PHP was uninvolved.

The [bounded native probe](../../tools/jetbrains-composer-race/README.md) reproduced the exact exception and line on the exact EAP SDK **without ++PHP on the classpath**. A sequential 10,000-operation control passed. Overlapping `inform` and `reset` reproduced the failure after 1,158 calls in the initial EAP run. The installed earlier PhpStorm runtime also reproduced the same exception at line 42 after 880 calls. These counts are observations, not timing guarantees.

Inspection of the unmodified implementation shows a non-atomic operation: it populates a concurrent map, then looks the entry up again and immediately iterates it. A concurrent reset can remove the entry between those operations. A concurrent collection makes each individual operation safe; it does not make that multi-step sequence atomic.

This proves an independently reachable native race. It does **not** reconstruct the exact thread scheduling in Marketplace's historical run or prove every IDE startup is affected. Fixing the shared state/synchronization inside the PHP plugin belongs to JetBrains. Do not patch vendor binaries, swallow their exceptions, disable Composer synchronization, remove supported IDEs merely to hide the report, or call a clean rerun a fix. Provide the minimal reproduction and original report to JetBrains and obtain their review of the submission.

One controlled Marketplace IDE-runtime rerun of the unchanged `2026.3.3` submission completed at 15:58 on September 10 with “No issues occurred during the IDE run with the plugin installed.” This supports intermittent behavior; it does not undo the original finding or establish a fix. The original report remains part of the evidence. Marketplace approval is a separate decision.

## Process correction

The previous handoff overclaimed readiness from binary verification and native component tests. Runtime project startup and asynchronous Composer activity are a separate acceptance dimension. A build can pass all existing checks and still fail there.

For the next upload, retain the exact artifact checksum and separately record source checks, binary verification, native component tests, real IDE lifecycle checks, and Marketplace runtime review. Use a clean ordinary PHP/Composer project as well as a mixed ++PHP project; exercise startup, indexing, configuration changes and shutdown. Include forced compiler failures in diagnostic acceptance, not only valid/error/repair happy paths. Read the with-plugin and without-plugin logs before assigning a runtime failure to either vendor.

Local package readiness, upload, Marketplace approval and availability to users are different states. Report them separately. A newly numbered tooling artifact may contain the diagnostic correction while a native upstream finding or compiler-release distribution gap remains unresolved; it must not be described as fixing those dependencies.
