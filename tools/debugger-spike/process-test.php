<?php

declare(strict_types=1);

require __DIR__ . '/Protocol.php';
require __DIR__ . '/Process.php';

use DebuggerSpike\Process;
use function DebuggerSpike\expect;

// POSIX-only regression: the fixture deliberately ignores graceful termination.
if (!function_exists('pcntl_signal')) {
    echo "NOT RUN stubborn-child test: pcntl is unavailable on this PHP runtime.\n";
    exit(0);
}
$child = new Process([PHP_BINARY, '-r', <<<'PHP'
pcntl_signal(SIGTERM, SIG_IGN);
echo "ready\n";
while (true) { usleep(10000); }
PHP]);
expect(fgets($child->pipes[1]) === "ready\n", 'Child did not install its signal handler.');
$started = hrtime(true);
$timedOut = false;
try {
    $child->finish(1);
} catch (RuntimeException $error) {
    $timedOut = $error->getMessage() === 'Child process did not finish.';
} finally {
    unset($child); // Includes termination, forced kill, stream closure and reap.
}
expect($timedOut, 'Expected the stubborn child to time out.');
$elapsed = (hrtime(true) - $started) / 1_000_000_000;
expect($elapsed < 3, 'Child cleanup exceeded its bounded grace period.');
echo "PASS timed-out child ignoring SIGTERM was force-killed and reaped\n";
