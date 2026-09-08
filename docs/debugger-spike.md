# Debugging ++PHP: what the experiment established

Assessment and executed spike, 8 September 2026. This is an engineering report,
not a claim that the published extensions include a debugger.

## Start with a quote calculation

Imagine a quote for three items. Each costs 100, tax is 30, and ordering at
least three earns a discount of 25. The correct total is 305.

The calculation is written in ++PHP. An existing tax calculator is ordinary PHP.
You want to click beside a line in the ++PHP file, start debugging, and follow
the calculation without opening the compiler's generated files.

The experiment uses this method, inside `DebuggerSpike\Quote`:

```php
public function calculate(int $quantity): int throws \RuntimeException
{
    int $unitPrice = 100;
    int $subtotal = $unitPrice * $quantity;
    int $tax = LegacyTax::calculate($subtotal);
    int $discount = when ($quantity >= 3) {
        return 25;
    } else {
        return 0;
    };
    int $total = $subtotal + $tax - $discount;
    if ($quantity === 0) {
        throw new \RuntimeException('Quantity must be positive');
    }
    return $total;
}
```

The ordinary PHP method is:

```php
public static function calculate(int $subtotal): int
{
    $tax = intdiv($subtotal, 10);
    return $tax;
}
```

The entry script loads the built files, calls `calculate(3)`, then calls
`calculate(0)` inside a catch block. The complete, executable files are in the
[spike fixture](../tools/debugger-spike/fixture/src). Its expected output is:

```text
305
Quantity must be positive
```

The debugger must pause **before** an assignment executes. At the subtotal line,
`unitPrice` exists; after stepping once, `subtotal` is 300. Stepping into the tax
call should open `LegacyTax.php`. Returning should bring us back to `Quote.ppphp`.
The second call should pause at the original `throw`, not at a generated PHP line.

## Decision in brief

**Reuse Xdebug. Build the ++PHP launch, source mapping, and editor experience
around it. A new runtime debugger is not justified by this spike.**

The experiment demonstrated real breakpoints, stepping, values, and exception
locations through both editor debugging implementations. It did not change
Xdebug or the compiler. It also exposed work that remains before this can feel
like a finished feature: breakpoint creation in PhpStorm, cleaner stepping
through lowered expressions, safe session/build handling, and runtime setup.

What you decided was to investigate a low-setup debugger through an end-to-end
spike. Choosing Xdebug, a particular integration architecture, and a managed PHP
installation are recommendations or open decisions—not decisions made for you.

## What was actually run

The compiler built a real mixed application. PHP executed the generated output.
Xdebug paused that PHP process. No simulated debugger responses were used.

| Check                                         | Result and boundary                                                                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original `.ppphp` assignment breakpoint       | PASS: the runtime confirmed the breakpoint was executable and stopped at source line 9.                                                                                                                                          |
| Step over assignments and inspect values      | PASS: unit price 100, subtotal 300, tax 30, discount 25, total 305.                                                                                                                                                              |
| Step into ordinary PHP, then return to ++PHP  | PASS through the direct runtime test, VS Code's adapter, and PhpStorm's native session.                                                                                                                                          |
| Conditional breakpoint inside a `when` branch | PASS in the direct runtime test: `$subtotal === 300` stopped at source line 13.                                                                                                                                                  |
| Exception location                            | PASS: the second invocation stopped at source line 19, the original `throw`.                                                                                                                                                     |
| Final program behavior                        | PASS: both expected output lines and a successful PHP exit.                                                                                                                                                                      |
| VS Code integration                           | PASS in a separate real VS Code extension host, using the installed, unmodified PHP Debug adapter. Source breakpoints, stack positions, Variables requests, a Watch request, stepping, and exception stopping were exercised.    |
| PhpStorm integration                          | PASS in the native session test, including source positions, stepping, value evaluation, exception stopping and clean teardown. This is not a manual gutter-click acceptance test.                                               |
| Existing PhpStorm gutter eligibility          | FAIL as a shipped capability: native PHP's breakpoint eligibility check returns false for the independent ++PHP file type. The spike registers a native breakpoint through the platform API to test the runtime path separately. |
| Clean stepping through `when`                 | PARTIAL: it reaches the correct branch and correct result, but also shows compiler-generated stops.                                                                                                                              |
| Unicode and CRLF line endings                 | PASS in a fresh compiler/runtime/safety run. This was on macOS; it is not evidence of Windows runtime support.                                                                                                                   |
| Stale and invalid artifacts                   | PASS in focused tests: changed source, output, manifest or map is rejected; unknown map formats, traversal paths and unowned breakpoint files are rejected.                                                                      |
| Xdebug absent / available                     | PASS: a clean PHP process reports it absent; a launch-specific extension argument loads the isolated build. An automatic installer was not implemented.                                                                          |
| Normal PHP configuration                      | Unchanged by the spike. No extension installation or global INI edit was performed.                                                                                                                                              |

### Evidence boundaries

The VS Code test uses the editor's actual extension host and debug-session APIs.
The PhpStorm test uses its actual platform test application, native debug
session, PHP debug process and Xdebug driver. Neither test substitutes a fake
adapter. The PhpStorm test is not a manually operated full IDE window.

This small application does not establish compatibility with frameworks,
Composer bootstrap arrangements, long-running workers, generators, fibers,
remote servers, containers, all PHP installations, or all IDE releases.
Those are **not run**, not implied passes.

## How it works

The compiler produces ordinary PHP plus a source map: a record connecting
positions in that PHP back to the file you wrote. Xdebug sees the PHP that is
actually running. A small **bridge**—a process that translates debugger
messages—connects those two views.

```text
VS Code's PHP debugger ─┐
                       ├─ ++PHP location bridge ─ Xdebug ─ running PHP
PhpStorm's PHP debugger ┘           │
                           compiler manifest and maps
```

For a breakpoint, the bridge translates the original source location to a
generated PHP location. For a stopped stack frame, it translates in the other
direction. Copied PHP files use the compiler's identity maps, so navigation
returns to the original PHP file instead of a build-directory copy.

The protocol between the bridge and Xdebug is **DBGp**, Xdebug's debugger
message format. VS Code's existing adapter already translates its editor
protocol, **DAP**, to DBGp. Reusing that adapter means we did not need to write
another implementation of variable inspection and stepping for this experiment.
PhpStorm uses its own native debugger implementation, not the VS Code adapter.

This bridge is a reuse experiment, not the final architecture. A production
implementation could keep a common DBGp bridge, extend an existing adapter, or
use native mapping hooks in PhpStorm. Whichever approach wins, the compiler's
meaning and the common mapping rules must not be independently reinvented in
each editor.

## What `when` taught us

The source has a `return 25` inside the value-producing expression. The generated
PHP assigns 25 to a temporary variable, exits generated control flow, copies
that temporary into `discount`, then removes the temporary.

There were two different issues, and they must not be confused:

1. **The first prototype chose the wrong byte on a generated line.** It skipped
   indentation and selected the generated variable, which belongs to the whole
   `when`. Inspection showed that the existing compiler map deliberately assigns
   the indentation and result expression to the branch's source location. Using
   the line start recovered the branch location. A real conditional breakpoint
   then stopped there. This was a bridge error, not missing compiler data.
2. **The runtime still executes additional statements.** In the uninterrupted
   editor stepping runs, the source stops were `12, 13, 12, 12, 12` before line 17. The values are right, but the visible stepping is not yet natural.

Simply skipping every repeated source line is unsafe: a real loop may revisit
that line and must remain debuggable. We need an explicit rule for generated
housekeeping versus meaningful source execution, tested against loops,
exceptions, nested expressions and calls. If current maps cannot express that
rule reliably, the compiler should supply additional debug information.

Useful additional information would describe legitimate pause points, generated
housekeeping, and temporary-variable ownership. Those are proposed requirements,
not a new compiler format introduced by this spike. The byte maps we have are
already more useful than the first prototype suggested.

## What is different in the two editors

### VS Code

A small experimental manifest allows breakpoints for the `ppphp` language.
The test then starts the existing PHP Debug adapter, launches the bridge and PHP,
and drives the editor's real debug session. No user `launch.json` was written.

The adapter can stop on a function return to show its return value. The test
records that additional stop explicitly; it is distinct from the unwanted
generated-code stops in `when`.

The installed PHP Debug adapter is MIT-licensed. Reuse remains subject to its
license and packaging requirements. The spike references the installed adapter;
it does not copy its source into this repository or add a production dependency.

### PhpStorm

The independent ++PHP language does not automatically inherit PHP's breakpoint
eligibility. The experiment first verifies that limitation, then registers a
native PHP breakpoint through the breakpoint manager to test the rest of the
session. This is why native-session success is not a claim that gutter-click
debugging already works for users.

Inspection also found `PhpTemplateLanguagePathMapper`, an existing PHP extension
point for mapping generated PHP to another source file type. PHP's breakpoint
eligibility explicitly recognizes registered template file types. This is a
promising integration route to investigate; this spike did **not** implement or
validate a production ++PHP mapping provider through that extension point.

The native session needs proper local-path mapping, connection startup, and
console disposal. Its initial-entry and return-value stops also differ from
the simple direct protocol client. These are real reasons to test PhpStorm
separately, rather than package the VS Code approach under another name.

## What “little setup” can realistically mean

After a compatible PHP runtime and Xdebug are available, the tools can own the
routine work: discover the project, build, validate maps, choose a local port,
launch PHP with debugging enabled for that process, and clean up afterwards.
The experiments demonstrated those building blocks without global INI edits.

They did not demonstrate a zero-install first run. Xdebug was initially absent.
For the spike it was downloaded from the official site and compiled into an
OS-temporary directory, without running `make install`. PHP loaded that module
only when launched with the corresponding argument.

For a finished feature, there are two reasonable setup paths:

- **Use the project's existing PHP.** Detect compatible Xdebug, and offer an
  explicit, guided setup action if it is missing. This preserves the application's
  existing extensions and runtime choices, but installations vary.
- **Offer a managed development runtime.** Supply PHP and Xdebug together for
  supported platforms. This offers a more predictable first run, but makes us
  responsible for distribution, updates, security fixes, and matching the
  application's other PHP extensions. It must not silently replace the project's
  selected runtime.

My recommendation is to deliver the existing-runtime path first and make the
managed-runtime decision separately. Start with local CLI applications and
tests, then a tool-launched local web server. Arbitrary PHP-FPM, Apache, Docker
and remote setups need their own launch, networking and path contracts.

## Safety and honest limits

The prototype binds only loopback addresses, uses ephemeral listeners, bounds
protocol messages and session duration, rejects DTDs in XML, and checks artifact
hashes before forwarding editor commands. It executes only the authored fixture
in these tests. No debugger payload is deliberately persisted by the bridge.

This is **not production hardening**. In particular:

- Hash checks are a stale-build guard, not an immutable filesystem snapshot.
  Another process could replace a file between a check and execution. Production
  sessions need a stable build or a coordinated restart policy.
- The bridge is one local session with a fixed sample layout and a basic
  source-line projection. It does not implement the whole DBGp protocol's source
  retrieval, virtual files, all breakpoint forms, multi-request sessions, or a
  complete path/security policy.
- It chooses the first generated candidate and relies on runtime resolution.
  A general debugger must represent zero, one or multiple executable locations
  honestly and report moved/pending/rejected breakpoints accurately.
- Watch expressions in this experiment are ordinary PHP expressions. Supporting
  ++PHP-only expressions is a separate compiler/evaluation question. Evaluation
  can execute application code; it is not the language server's static analysis.
- Erased generics are not automatically recoverable as runtime type arguments.
  Showing source-declared types beside runtime values would require an explicit
  design and must not fabricate runtime information.
- The missing-engine probe is not an installer, and there is no automatic
  download or machine-wide configuration change in the delivered harness.

These limitations are reasons for scoped product work, not reasons to replace
Xdebug with a new engine. A fresh engine would still need runtime distribution,
source mapping, both editor integrations, and compatibility maintenance.

## Why having a compiler helps—but does not replace the debugger

The compiler knows that a generated assignment came from your `return 25`.
It does not know the value of `subtotal` in a particular running request. Xdebug
supplies that second part: it can pause the PHP process and inspect its live
variables and call stack. The compiler makes that information understandable in
terms of the code you wrote.

There are three materially different choices:

- **Use Xdebug unchanged**, as this experiment did. We own launching, source
  translation and the editor workflow, while reusing its runtime inspection.
  This is the recommended starting point.
- **Fork Xdebug.** This adds responsibility for maintaining a native PHP
  extension. The observed problems are outside the engine, so the spike found
  no reason to take on that responsibility yet.
- **Create a different engine**, possibly by inserting pause/inspection calls
  into compiled PHP. That may avoid an Xdebug installation for some cases, but
  it is not automatically an equivalent debugger: ordinary PHP dependencies
  would need coverage too, and inserted calls must preserve program behavior.
  It requires a separate experiment. We did not implement or benchmark it, and
  the success of this Xdebug route is not evidence that another route is impossible.

In short, the compiler can remove much of the _source-mapping_ difficulty.
It cannot by itself remove the need for a way to control the running program.

## Recommended work after the spike

One debugger workstream, with VS Code and PhpStorm as its two acceptance targets:

1. Define the source-level stepping and breakpoint contract using these fixtures
   plus loops, nested `when`, exceptions and mixed PHP calls.
2. Select the supported native PhpStorm mapping/breakpoint route; compare it with
   the shared bridge before committing to a permanent integration boundary.
3. Deliver a clearly scoped local CLI Debug action: correct source breakpoints,
   variables, stack, exceptions, cancel/restart, and actionable setup failures.
4. Validate supported operating systems and runtime combinations, including
   spaces/symlinks in paths, untrusted workspaces and absent/incompatible engines.
5. Add test-runner and local-web-server launchers. Decide managed runtime and
   container/remote support separately.

The result of the spike is a **go for an Xdebug-backed debugger**, not a claim
that a polished debugger is finished. The difficult remaining work is precise
source-level behavior and dependable setup—not basic access to PHP's running
stack and variables.

## Reproduction and dated evidence

See the [experiment README](../tools/debugger-spike/README.md) for executable
commands, isolation requirements and the test sources. Keep raw captures and IDE
profiles in OS temporary storage, not in this repository.

The compiler tested was commit `def46c02d6dee5364f09f688f9a7e9ab659fd70d`.
That is the local compiler mainline, not proof that an immutable published
compiler archive contains every same change. The tooling starting point was
`28977987aefd5aa204ced12d5981cb0dee9e3c0b`.

The executed environment was macOS on Apple Silicon, PHP 8.5.10, isolated
Xdebug 3.5.3, VS Code's installed PHP Debug adapter 1.40.1, and the repository's
PhpStorm 2025.2.1 SDK. These versions identify an experiment; they are not new
public compatibility promises. The official Xdebug source archive used had
SHA-256 `f073de91bea046106abf4d6071c963ea71e58571df6ce58948ceca89d121cb2d`.

## External references

- [Xdebug installation](https://xdebug.org/docs/install): native extension setup
  and PHP/platform compatibility.
- [Xdebug DBGp protocol](https://xdebug.org/docs/dbgp): breakpoints, stepping,
  stack, variables and expression evaluation.
- [Xdebug step debugging](https://xdebug.org/docs/step_debug): runtime behavior,
  resolved breakpoints and executable-line queries.
- [VS Code PHP Debug](https://github.com/xdebug/vscode-php-debug): the reused
  adapter, its source and license.
- [VS Code debugger extension architecture](https://code.visualstudio.com/api/extension-guides/debugger-extension):
  editor and debug adapter responsibilities.
- [PhpStorm CLI debugging](https://www.jetbrains.com/help/phpstorm/zero-configuration-debugging-cli.html):
  launch-specific runtime configuration.
