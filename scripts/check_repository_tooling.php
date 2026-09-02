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

$buildScript = @file_get_contents($repositoryRoot . '/scripts/build.php');
if ($buildScript === false) {
    fwrite(STDERR, "could not read the repository build script\n");
    exit(1);
}

$buildRequirements = [
    "['ci']" => 'restore missing Node.js dependencies with locked npm ci',
    'NPM_INSTALL_TIMEOUT_SECONDS' => 'bound automatic npm installs',
    "['ls', '--include-workspace-root', '--workspaces', '--depth=0', '--json']" =>
        'validate every npm workspace before building',
    "'/node_modules/@ppphp/language-server'" =>
        'verify the language-server workspace link before building',
    "'/node_modules/ppphp-vscode'" =>
        'verify the VS Code workspace link before building',
    'paths_resolve_to_same_location(' =>
        'validate workspace links against their expected source directories',
    "PHP_OS_FAMILY === 'Windows' ? 'esbuild.cmd' : 'esbuild'" =>
        'reject Node.js installations copied from an incompatible platform',
    'wait_for_process(' => 'apply deadlines to repository build subprocesses',
    "['taskkill', '/PID', (string) \$processId, '/T', '/F']" =>
        'terminate timed-out Windows subprocess trees',
    "['run', 'bundle', '--workspace', '@ppphp/language-server']" =>
        'bundle the language server without recursing through its public build command',
];
foreach ($buildRequirements as $source => $description) {
    if (!str_contains($buildScript, $source)) {
        fwrite(STDERR, "build script must {$description}\n");
        exit(1);
    }
}

$languageServerPackage = @file_get_contents(
    $repositoryRoot . '/packages/language-server/package.json',
);
if (
    $languageServerPackage === false
    || !str_contains($languageServerPackage, '"build": "php ../../scripts/build.php server"')
) {
    fwrite(STDERR, "language-server builds must use the PHP dependency bootstrap\n");
    exit(1);
}

fwrite(
    STDOUT,
    'Repository tooling is PHP and all ' . count($phpScripts) . " scripts pass syntax checks.\n",
);
