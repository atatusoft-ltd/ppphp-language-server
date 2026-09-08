<?php

declare(strict_types=1);

require __DIR__ . '/Protocol.php';
require __DIR__ . '/Process.php';

use DebuggerSpike\Process;
use function DebuggerSpike\expect;

// Build orchestration stays in PHP. This does not install or download anything.
// The returned temporary project can subsequently be used by either editor test.
$options = getopt('', ['compiler:', 'xdebug:', 'crlf']);
try {
    $compiler = realpath($options['compiler'] ?? '');
    $extension = realpath($options['xdebug'] ?? '');
    expect($compiler !== false && is_file($compiler), 'Provide --compiler=/absolute/path/to/bin/ppphp');
    expect($extension !== false && is_file($extension), 'Provide --xdebug=/absolute/path/to/xdebug.so (or its platform equivalent).');
    $probe = new Process([PHP_BINARY, '-d', 'zend_extension=' . $extension, '-r', 'echo json_encode(["php" => PHP_VERSION, "xdebug" => phpversion("xdebug")]);']);
    $versions = json_decode($probe->finish(), true, flags: JSON_THROW_ON_ERROR);
    expect(is_string($versions['xdebug'] ?? null), 'Xdebug cannot load into this PHP binary.');
    echo 'Runtime: ', json_encode($versions), "\n";
    $root = sys_get_temp_dir() . '/ppphp-debugger-spike-' . bin2hex(random_bytes(6));
    expect(mkdir($root . '/src', 0700, true), 'Cannot create an isolated project.');
    copy(__DIR__ . '/fixture/ppphp.json', $root . '/ppphp.json');
    foreach (glob(__DIR__ . '/fixture/src/*') as $path) {
        $contents = file_get_contents($path);
        // A Unicode comment changes byte offsets without changing line numbers.
        $contents = preg_replace('/^<\?php\n\n/', "<?php\n// café π: debugger byte-offset probe\n", $contents, 1);
        if (isset($options['crlf'])) {
            $contents = str_replace("\n", "\r\n", $contents);
        }
        file_put_contents($root . '/src/' . basename($path), $contents);
    }
    echo 'Project: ', $root, "\n";
    $build = new Process([PHP_BINARY, '-d', 'memory_limit=512M', $compiler, 'build', '--working-directory=' . $root]);
    echo $build->finish(120);
    foreach (['runtime.php', 'safety.php', 'process-test.php'] as $test) {
        $process = new Process([PHP_BINARY, __DIR__ . '/' . $test, $root, $extension]);
        echo $process->finish(120);
    }
    echo "PASS runtime + safety spike. Temporary project retained for editor tests.\n";
} catch (Throwable $error) {
    fwrite(STDERR, 'FAIL: ' . $error->getMessage() . "\n");
    exit(1);
}
