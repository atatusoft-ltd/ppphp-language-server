<?php

declare(strict_types=1);

require __DIR__ . '/SourceMaps.php';
require __DIR__ . '/Protocol.php';
require __DIR__ . '/Process.php';

use DebuggerSpike\Process;
use DebuggerSpike\SourceMaps;
use function DebuggerSpike\expect;

[$script, $root, $extension] = $argv;
$root = realpath($root);
expect(str_starts_with($root, realpath(sys_get_temp_dir()) . '/') || str_starts_with($root, '/private/tmp/'), 'Safety tests only mutate an OS-temporary fixture.');
$probe = new Process([PHP_BINARY, '-n', '-r', 'echo extension_loaded("xdebug") ? "loaded" : "missing";']);
expect($probe->finish() === 'missing', 'Missing-extension probe was not isolated.');
echo "PASS missing-engine detection: clean PHP reports no Xdebug\n";
$probe = new Process([PHP_BINARY, '-d', 'zend_extension=' . $extension, '-r', 'echo extension_loaded("xdebug") ? "loaded" : "missing";']);
expect($probe->finish() === 'loaded', 'Test extension does not load into the selected PHP runtime.');
echo "PASS compatible engine can be loaded for one process\n";

function rejected(callable $operation, string $label): void
{
    try {
        $operation();
    } catch (RuntimeException $error) {
        echo "PASS rejected $label\n";
        return;
    }
    throw new RuntimeException('Accepted ' . $label);
}

$maps = new SourceMaps($root);
$source = $root . '/src/Quote.ppphp';
$output = $root . '/build/Quote.php';
$manifest = $root . '/build/.ppphp/manifest.json';
$map = $root . '/build/.ppphp/source-maps/Quote.php.map.json';
foreach ([$source, $output, $manifest, $map] as $path) {
    $contents = file_get_contents($path);
    try {
        file_put_contents($path, $contents . "\n");
        rejected(fn () => $maps->assertFresh(), 'changed session artifact ' . basename($path));
        if ($path === $source || $path === $output) {
            rejected(fn () => new SourceMaps($root), 'stale startup ' . basename($path));
        }
    } finally {
        file_put_contents($path, $contents);
    }
}
$contents = file_get_contents($map);
try {
    $data = json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
    $data['formatVersion'] = 999;
    file_put_contents($map, json_encode($data));
    rejected(fn () => new SourceMaps($root), 'unknown map format');
} finally {
    file_put_contents($map, $contents);
}
rejected(fn () => SourceMaps::inside($root, '../outside.php'), 'path traversal');
rejected(fn () => $maps->generated($root . '/not-owned.php', 1), 'unowned breakpoint source');
$maps->assertFresh();
echo "PASS original fixture restored; runtime and source hashes still match\n";
