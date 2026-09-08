# Debugger feasibility experiment

Read the [plain-English report](../../docs/debugger-spike.md) first. This folder
contains an opt-in experiment, not a debugger shipped by either extension.

The shared PHP bridge translates source locations between a real Xdebug process
and existing editor debuggers. The fixture deliberately mixes ordinary PHP with
++PHP, checked errors, typed locals and a lowered `when` expression.

## Requirements and isolation

- A working local compiler checkout and its Composer dependencies.
- PHP with a compatible Xdebug module available as a file. It does not need to
  be globally enabled. The harness loads it for the application process only.
- Repository Node dependencies for the VS Code test; its PHP Debug and ++PHP
  extensions must already be installed or unpacked.
- The repository's Java/Gradle/PhpStorm SDK setup for the native IDE test.
- Permission for loopback sockets and launching the explicitly authored fixture.

Use a trusted fixture, not an arbitrary downloaded project. Debug evaluation
executes PHP. Nothing here installs Xdebug, edits global INI files, changes the
normal editor profile, downloads a managed runtime, or publishes an extension.

Keep every test project, IDE profile, protocol capture, log and result report in
an operating-system temporary directory outside all user workspaces. Do not run
the mutation tests against a real application or concurrently with an editor
session using the same fixture. The test source files and this report are the
reproducible deliverables; temporary build outputs are not committed.

## Build and run the core experiment

From the language-server repository, substitute the compiler and module paths:

```sh
php tools/debugger-spike/run.php \
  --compiler=/absolute/path/to/ppphp-src/bin/ppphp \
  --xdebug=/absolute/path/to/xdebug.so
```

The runner checks that the selected PHP can load Xdebug, creates a fresh
temporary fixture, builds it with the real compiler, runs the runtime tests,
then runs the stale-artifact and malformed-input checks. It prints the temporary
project path for subsequent editor tests. It adds a Unicode comment to test byte
offsets without changing source line numbers.

Repeat with `--crlf` to exercise Windows-style line endings. A passing CRLF run
on macOS is not a Windows-platform test.

The core test checks:

- A source breakpoint is confirmed executable by Xdebug.
- Step over, step into PHP, and step out to ++PHP.
- Local values and PHP expression evaluation.
- A conditional breakpoint inside a `when` branch.
- The original exception location and expected output.
- Rejection of stale source/output, changed map/manifest, unsupported map format,
  traversal paths, and unknown breakpoint sources.
- Bounded cleanup of a timed-out child that ignores SIGTERM (requires `pcntl`;
  otherwise reported as NOT RUN). The supervisor force-kills after a short grace period.

`OBSERVE` lines record behavior, not successes. In particular, the additional
`when` stops are a known quality gap even when the test completes successfully.

## Run the real VS Code extension-host test

Set these to the temporary project printed above and the relevant local paths:

```sh
export PPPHP_SPIKE_TEMP=/absolute/os-temporary/spike-directory
export PPPHP_SPIKE_PROJECT=/absolute/os-temporary/generated-fixture
export PPPHP_SPIKE_PHP=/absolute/path/to/php
export PPPHP_SPIKE_XDEBUG=/absolute/path/to/xdebug.so
export PPPHP_SPIKE_BRIDGE="$PWD/tools/debugger-spike/bridge.php"
export PPPHP_SPIKE_RESULT="$PPPHP_SPIKE_TEMP/vscode-result.json"
```

Prepare a dedicated temporary extensions directory containing the installed PHP
Debug extension and the installed ++PHP extension. On macOS/Linux, symlinks to
those existing extension directories suffice. Do not point the test's
`--user-data-dir` at the normal VS Code profile.

```sh
./node_modules/.bin/esbuild tools/debugger-spike/vscode/smoke.ts \
  --bundle --platform=node --external:vscode \
  --outfile="$PPPHP_SPIKE_TEMP/vscode-smoke.cjs"

"/Applications/Visual Studio Code.app/Contents/MacOS/Code" \
  --user-data-dir="$PPPHP_SPIKE_TEMP/vscode-user" \
  --extensions-dir="$PPPHP_SPIKE_TEMP/vscode-extensions" \
  --extensionDevelopmentPath="$PWD/tools/debugger-spike/vscode" \
  --extensionTestsPath="$PPPHP_SPIKE_TEMP/vscode-smoke.cjs" \
  --skip-welcome --skip-release-notes --disable-workspace-trust \
  "$PPPHP_SPIKE_PROJECT"
```

The trust bypass above applies only to this explicitly authored temporary
fixture. It is not a proposed product default. Adjust the executable for your
platform; only macOS was executed in this spike.

The test opens the original `.ppphp` document, verifies its language identity,
adds a source breakpoint through VS Code, starts the installed PHP Debug adapter,
and exercises the real debug session. A bounded result summary is written to
`PPPHP_SPIKE_RESULT`; the editor exits after testing. No adapter source is patched.

## Run the native PhpStorm session test

Use the same environment variables and a Java installation suitable for the
repository build. Then:

```sh
./editors/phpstorm/gradlew -p editors/phpstorm \
  -PdebuggerSpike=true test --tests '*PpphpDebuggerSpikeTest' \
  --console=plain --no-problems-report
```

The opt-in property adds this folder's Kotlin test to the test source set and
places the IDE sandbox and reports beneath `PPPHP_SPIKE_TEMP`. Normal builds do
not include this test, and no experimental debugger classes enter the plugin.
Use `--rerun` when rerunning after changing only the external PHP bridge: Gradle
does not track that bridge as a Kotlin test input.

The test first proves that PHP's native gutter eligibility returns false for
the independent ++PHP file type. It then registers a PHP breakpoint through the
native breakpoint manager and starts a real native PHP debug session using the
existing Xdebug driver. It verifies the original source positions, cross-language
stepping, subtotal evaluation, exception location, output and teardown.

That separates two questions: whether native runtime debugging works, and whether
ordinary users can create the breakpoint through the existing gutter. The former
passes; the latter needs an explicit ++PHP integration. This test is not evidence
of a fully implemented Run/Debug action or manual gutter-click workflow.

## Experiment-only Xdebug build used in the recorded run

The dated report records the official archive version and hash. To reproduce
that engine without installing it globally, download the verified official
source archive into a fresh OS temporary directory, unpack it there, and run:

```sh
phpize
./configure --enable-xdebug --with-php-config=/absolute/path/to/php-config
make -j4
```

Use `modules/xdebug.so` from that temporary build. **Do not run `make install`.**
Use `phpize` and `php-config` matching the PHP runtime you intend to execute.
The Windows build/distribution path was not tested here.

This manual preparation is an acknowledged first-run gap, not evidence of an
automatic installer. A product setup assistant or managed runtime is separate
work described in the report.

## Prototype limitations

The bridge is single-session, loopback-only, and assumes the fixture's `build`
layout. It performs a line-start projection over existing byte maps. It does not
implement the complete DBGp protocol, hide generated stepping, recover erased
runtime type arguments, or provide immutable build snapshots. Watches use PHP
syntax. The report lists the remaining security and compatibility work.

Do not promote the bridge to a production feature by merely packaging this
folder. The purpose is executable evidence for choosing the architecture.
