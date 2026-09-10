<?php

// Test-only deterministic transport peer; never executes supplied source.
$root = $argv[array_search('--working-directory', $argv, true) + 1];
$server = in_array('--server', $argv, true);
$mode = trim(@file_get_contents($root . '/mode') ?: 'normal');
$log = static function (array $entry) use ($root): void {
    file_put_contents($root . '/transport.log', json_encode(['pid' => getmypid(), ...$entry]) . "\n", FILE_APPEND);
};
$log(['type' => 'start', 'server' => $server, 'memoryLimit' => ini_get('memory_limit'), 'memoryLimitEnvironment' => getenv('PPPHP_COMPILER_MEMORY_LIMIT_MEGABYTES')]);
$write = static function (array $frame) use ($mode): void {
    $json = json_encode($frame, JSON_UNESCAPED_UNICODE) . ($mode === 'fragmented' ? "\r\n" : "\n");
    if ($mode === 'fragmented') {
        foreach (str_split($json, 13) as $chunk) {
            fwrite(STDOUT, $chunk);
            fflush(STDOUT);
            usleep(100);
        }
    } else {
        fwrite(STDOUT, $json);
        fflush(STDOUT);
    }
};
$result = static function (array $request) use ($root): array {
    if (str_contains($request['document']['contents'], 'unavailable')) {
        if (str_contains($request['document']['contents'], 'slow-unavailable')) { usleep(300000); }
        return ['version' => 1, 'error' => ['message' => 'Document analysis unavailable']];
    }
    if (trim(@file_get_contents($root . '/mode') ?: '') === 'out-of-memory') {
        fwrite(STDERR, "PHP Fatal error: Allowed memory size of 536870912 bytes exhausted (tried to allocate 4096 bytes) in /private/project/Secret.php on line 17\n");
        exit(255);
    }
    if (trim(@file_get_contents($root . '/mode') ?: '') === 'broken-all') {
        return ['version' => 1, 'error' => ['message' => 'Test compiler unavailable']];
    }
    $document = $request['document'];
    return [
        'version' => 1,
        'document' => ['path' => $document['path'], 'version' => $document['version']],
        'diagnostics' => str_contains($document['contents'], 'bad') ? [[
            'code' => 'P1001', 'message' => 'Bad syntax 🐘', 'severity' => 'error',
            'location' => ['file' => $document['path'], 'range' => ['start' => ['offset' => 0], 'end' => ['offset' => 1]]],
        ]] : [],
        'analysis' => ['completeness' => 'compilerCore', 'fullParity' => true, 'supplemental' => false],
        'error' => null,
    ];
};
if (!$server) {
    $request = json_decode(stream_get_contents(STDIN), true);
    $log(['type' => 'request', 'server' => false, 'version' => $request['document']['version']]);
    $write($result($request));
    exit(0);
}
if ($mode === 'unsupported') { fwrite(STDERR, 'Unknown --server option'); exit(2); }
if ($mode === 'startup-timeout') { sleep(10); }
if ($mode === 'oversized') { fwrite(STDOUT, str_repeat('x', 4195329)); sleep(10); }
$capabilities = [
    'diagnosticsVersion' => 1, 'maxInFlight' => 1, 'cancellation' => 'client-discard',
    'maxFrameBytes' => 16778240, 'maxResponseBytes' => 4195328,
    'maxRequests' => $mode === 'recycle' ? 2 : 1000, 'singleShotFallback' => true,
];
if ($mode === 'bad-capabilities') { $capabilities['cancellation'] = 'kill'; }
$write(['version' => $mode === 'bad-version' ? 2 : 1, 'type' => 'ready', 'compilerVersion' => 'test', 'compilerBuildIdentity' => $mode === 'bad-identity' ? '' : 'sha256:test', 'capabilities' => $capabilities]);
while (($line = fgets(STDIN)) !== false) {
    $frame = json_decode($line, true);
    $id = $frame['id'];
    $request = $frame['params'];
    $log(['type' => 'request', 'id' => $id, 'version' => $request['document']['version']]);
    if ($mode === 'request-timeout') { sleep(10); }
    if ($mode === 'slow') { usleep(150000); }
    if ($mode === 'installation-changed' || $mode === 'installation-loop') {
        if ($mode === 'installation-changed') { file_put_contents($root . '/mode', 'normal'); }
        $write(['version' => 1, 'id' => $id, 'error' => ['code' => 'installation-changed'], 'recycle' => true]);
        exit(0);
    }
    if ($mode === 'eof') { exit(0); }
    if ($mode === 'stderr-overflow') { fwrite(STDERR, str_repeat('e', 65537)); sleep(10); }
    if ($mode === 'invalid-utf8') { fwrite(STDOUT, "{\"version\":1,\"x\":\"\xff\"}\n"); exit(0); }
    $response = ['version' => 1, 'id' => $mode === 'wrong-id' ? $id + 1 : $id,
        'result' => $result($request), 'recycle' => $mode === 'recycle' && $id === 2];
    if ($mode === 'truncated') { fwrite(STDOUT, json_encode($response)); exit(0); }
    if ($mode === 'transport-error') { $response = ['version' => 1, 'id' => $id, 'error' => ['code' => 'invalid-frame'], 'recycle' => true]; }
    if ($mode === 'extra-frame') { fwrite(STDOUT, json_encode($response) . "\n" . json_encode($response) . "\n"); }
    else { $write($response); }
    if ($response['recycle']) { exit(0); }
}
