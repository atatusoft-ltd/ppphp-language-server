#!/usr/bin/env php
<?php

declare(strict_types=1);

$repositoryRoot = dirname(__DIR__);
$scriptDirectories = [
    $repositoryRoot . '/scripts',
    $repositoryRoot . '/editors/vscode/scripts',
];
$phpScripts = [];
$unexpectedScripts = [];

foreach ($scriptDirectories as $directory) {
    if (!is_dir($directory)) {
        continue;
    }

    $entries = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY,
    );
    foreach ($entries as $entry) {
        if (!$entry->isFile()) {
            continue;
        }
        if (strtolower($entry->getExtension()) !== 'php') {
            $unexpectedScripts[] = $entry->getPathname();
            continue;
        }
        $phpScripts[] = $entry->getPathname();
    }
}

if ($unexpectedScripts !== []) {
    foreach ($unexpectedScripts as $path) {
        fwrite(STDERR, "repository automation must be PHP: {$path}\n");
    }
    exit(1);
}

sort($phpScripts);
foreach ($phpScripts as $script) {
    $contents = @file_get_contents($script);
    if ($contents === false) {
        fwrite(STDERR, "could not read repository script: {$script}\n");
        exit(1);
    }
    if (!str_starts_with($contents, "#!/usr/bin/env php\n<?php\n")) {
        fwrite(STDERR, "repository script must start with the standard PHP shebang: {$script}\n");
        exit(1);
    }

    $process = proc_open(
        [PHP_BINARY, '-l', $script],
        [
            0 => ['file', 'php://stdin', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ],
        $pipes,
        $repositoryRoot,
    );
    if (!is_resource($process)) {
        fwrite(STDERR, "could not start PHP syntax check for {$script}\n");
        exit(1);
    }

    $output = stream_get_contents($pipes[1]);
    $error = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $status = proc_close($process);
    if ($status !== 0) {
        fwrite(STDERR, $error !== '' ? $error : $output);
        exit($status);
    }
}

fwrite(
    STDOUT,
    'Repository tooling is PHP and all ' . count($phpScripts) . " scripts pass syntax checks.\n",
);
