#!/usr/bin/env php
<?php

declare(strict_types=1);

const DEFAULT_COMMAND_TIMEOUT_SECONDS = 1800;
const DEPENDENCY_CHECK_TIMEOUT_SECONDS = 30;
const NPM_INSTALL_TIMEOUT_SECONDS = 600;

$repositoryRoot = dirname(__DIR__);
$target = $argv[1] ?? 'help';

if (count($argv) > 2) {
    usage_error('build targets do not accept additional arguments');
}

try {
    match ($target) {
        'server' => build_server($repositoryRoot),
        'vscode-extension' => build_vscode_extension($repositoryRoot),
        'vscode' => package_vscode($repositoryRoot),
        'phpstorm' => build_phpstorm($repositoryRoot),
        'editors', 'all' => build_editors($repositoryRoot),
        'help', '--help', '-h' => print_usage(),
        default => usage_error("unknown target '{$target}'"),
    };
} catch (Throwable $error) {
    fwrite(STDERR, "build: {$error->getMessage()}\n");
    exit(1);
}

function build_server(string $root): void
{
    ensure_node_dependencies($root);
    $artifact = $root . '/packages/language-server/dist/server.cjs';
    remove_stale_artifacts($artifact);
    run_tool('npm', ['run', 'bundle', '--workspace', '@ppphp/language-server'], $root);
    require_artifact($artifact, 'language-server bundle');
}

function ensure_node_dependencies(string $root): void
{
    if (node_dependencies_are_ready($root)) {
        return;
    }

    if (!is_file($root . '/package-lock.json')) {
        throw new RuntimeException('package-lock.json is required to install Node.js dependencies');
    }

    fwrite(
        STDOUT,
        "\nNode.js workspace dependencies are missing or incompatible with this platform.\n"
            . "Installing the locked dependency tree with npm ci...\n",
    );
    run_tool('npm', ['ci'], $root, NPM_INSTALL_TIMEOUT_SECONDS);

    if (!node_dependencies_are_ready($root)) {
        throw new RuntimeException(
            'npm ci completed, but the Node.js workspace dependencies are still unusable',
        );
    }
}

function node_dependencies_are_ready(string $root): bool
{
    $workspaceLinks = [
        $root . '/node_modules/@ppphp/language-server' =>
            $root . '/packages/language-server',
        $root . '/node_modules/ppphp-vscode' => $root . '/editors/vscode',
    ];
    foreach ($workspaceLinks as $link => $workspace) {
        if (!paths_resolve_to_same_location($link, $workspace)) {
            return false;
        }
    }

    $workspaceCheck = tool_command(
        'npm',
        ['ls', '--include-workspace-root', '--workspaces', '--depth=0', '--json'],
    );
    if (!command_succeeds($workspaceCheck, $root)) {
        return false;
    }

    $esbuild = $root . '/node_modules/.bin/'
        . (PHP_OS_FAMILY === 'Windows' ? 'esbuild.cmd' : 'esbuild');
    if (!is_file($esbuild)) {
        return false;
    }

    $esbuildCheck = PHP_OS_FAMILY === 'Windows'
        ? windows_command($esbuild, ['--version'])
        : [$esbuild, '--version'];
    return command_succeeds($esbuildCheck, $root);
}

function paths_resolve_to_same_location(string $left, string $right): bool
{
    $resolvedLeft = realpath($left);
    $resolvedRight = realpath($right);
    if ($resolvedLeft === false || $resolvedRight === false) {
        return false;
    }

    return PHP_OS_FAMILY === 'Windows'
        ? strcasecmp($resolvedLeft, $resolvedRight) === 0
        : $resolvedLeft === $resolvedRight;
}

function build_vscode_extension(string $root): void
{
    $extension = $root . '/editors/vscode';
    $dist = $extension . '/dist';
    $images = $extension . '/images';

    run_command([PHP_BINARY, $root . '/scripts/sync_language_resources.php'], $root);
    build_server($root);

    remove_generated_directory($dist, $extension);
    remove_generated_directory($images, $extension);
    ensure_directory($dist);
    ensure_directory($images);
    ensure_directory($root . '/build');

    run_tool('npm', ['run', 'bundle', '--workspace', 'ppphp-vscode'], $root);

    copy_required_file(
        $root . '/packages/language-server/dist/server.cjs',
        $dist . '/server.cjs',
    );
    copy_required_file($root . '/LICENSE', $extension . '/LICENSE');
    copy_required_file(
        $root . '/res/images/ppphp-emblem.svg',
        $images . '/ppphp-emblem.svg',
    );
    copy_required_file(
        $root . '/res/images/ppphp-emblem-128.png',
        $images . '/ppphp-emblem-128.png',
    );

    require_artifact($dist . '/extension.cjs', 'VS Code extension bundle');
    require_artifact($dist . '/server.cjs', 'bundled VS Code language server');
}

function package_vscode(string $root): void
{
    run_command([PHP_BINARY, $root . '/scripts/check_release_version.php'], $root);
    build_vscode_extension($root);

    $artifact = $root . '/build/ppphp-vscode.vsix';
    remove_stale_artifacts($artifact);
    run_tool('npm', ['run', 'package', '--workspace', 'ppphp-vscode'], $root);
    require_artifact($artifact, 'VS Code extension');
}

function build_phpstorm(string $root): void
{
    run_command([PHP_BINARY, $root . '/scripts/check_release_version.php'], $root);
    $editor = $root . '/editors/phpstorm';
    remove_stale_artifacts($editor . '/build/distributions/*.zip');

    $gradle = PHP_OS_FAMILY === 'Windows' ? $editor . '/gradlew.bat' : $editor . '/gradlew';
    $arguments = ['-p', $editor, 'check', 'buildPlugin', '--no-daemon'];
    $command = PHP_OS_FAMILY === 'Windows'
        ? windows_command($gradle, $arguments)
        : [$gradle, ...$arguments];
    run_command($command, $root);

    $artifacts = glob($editor . '/build/distributions/*.zip') ?: [];
    if (count($artifacts) !== 1) {
        throw new RuntimeException(
            'PhpStorm plugin build must produce exactly one ZIP; found ' . count($artifacts),
        );
    }
    require_artifact($artifacts[0], 'PhpStorm plugin');
}

function build_editors(string $root): void
{
    package_vscode($root);
    build_phpstorm($root);
}

function copy_required_file(string $source, string $destination): void
{
    if (!is_file($source)) {
        throw new RuntimeException("required input was not found at {$source}");
    }
    ensure_directory(dirname($destination));
    if (!copy($source, $destination)) {
        throw new RuntimeException("could not copy {$source} to {$destination}");
    }
}

/** @param list<string> $arguments */
function run_tool(
    string $tool,
    array $arguments,
    string $workingDirectory,
    int $timeoutSeconds = DEFAULT_COMMAND_TIMEOUT_SECONDS,
): void
{
    run_command(tool_command($tool, $arguments), $workingDirectory, $timeoutSeconds);
}

/**
 * @param list<string> $arguments
 * @return list<string>
 */
function tool_command(string $tool, array $arguments): array
{
    return PHP_OS_FAMILY === 'Windows'
        ? windows_command($tool, $arguments)
        : [$tool, ...$arguments];
}

/**
 * @param list<string> $arguments
 * @return list<string>
 */
function windows_command(string $executable, array $arguments): array
{
    $commandProcessor = getenv('COMSPEC');
    if ($commandProcessor === false || $commandProcessor === '') {
        $commandProcessor = 'cmd.exe';
    }

    return [$commandProcessor, '/d', '/c', $executable, ...$arguments];
}

/** @param list<string> $command */
function run_command(
    array $command,
    string $workingDirectory,
    int $timeoutSeconds = DEFAULT_COMMAND_TIMEOUT_SECONDS,
): void
{
    if ($timeoutSeconds < 1) {
        throw new InvalidArgumentException('command timeout must be at least one second');
    }

    fwrite(STDOUT, "\n> " . display_command($command) . "\n");
    $process = proc_open(
        $command,
        [
            0 => ['file', 'php://stdin', 'r'],
            1 => ['file', 'php://stdout', 'w'],
            2 => ['file', 'php://stderr', 'w'],
        ],
        $pipes,
        $workingDirectory,
    );
    if (!is_resource($process)) {
        throw new RuntimeException('could not start command: ' . display_command($command));
    }

    $status = wait_for_process($process, $command, $timeoutSeconds);
    if ($status !== 0) {
        throw new RuntimeException(
            "command failed with exit code {$status}: " . display_command($command),
        );
    }
}

/** @param list<string> $command */
function command_succeeds(array $command, string $workingDirectory): bool
{
    $nullDevice = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
    $process = proc_open(
        $command,
        [
            0 => ['file', $nullDevice, 'r'],
            1 => ['file', $nullDevice, 'w'],
            2 => ['file', $nullDevice, 'w'],
        ],
        $pipes,
        $workingDirectory,
    );
    if (!is_resource($process)) {
        return false;
    }

    try {
        return wait_for_process(
            $process,
            $command,
            DEPENDENCY_CHECK_TIMEOUT_SECONDS,
        ) === 0;
    } catch (RuntimeException) {
        return false;
    }
}

/**
 * @param resource $process
 * @param list<string> $command
 */
function wait_for_process($process, array $command, int $timeoutSeconds): int
{
    $deadline = microtime(true) + $timeoutSeconds;
    while (true) {
        $status = proc_get_status($process);
        if (!$status['running']) {
            $reportedExitCode = $status['exitcode'];
            $closedExitCode = proc_close($process);
            return $reportedExitCode >= 0 ? $reportedExitCode : $closedExitCode;
        }

        if (microtime(true) >= $deadline) {
            terminate_process($process, $status['pid']);
            proc_close($process);
            throw new RuntimeException(
                "command timed out after {$timeoutSeconds} seconds: "
                    . display_command($command),
            );
        }

        usleep(100_000);
    }
}

/** @param resource $process */
function terminate_process($process, int $processId): void
{
    if (PHP_OS_FAMILY === 'Windows' && $processId > 0) {
        $nullDevice = 'NUL';
        $killer = proc_open(
            ['taskkill', '/PID', (string) $processId, '/T', '/F'],
            [
                0 => ['file', $nullDevice, 'r'],
                1 => ['file', $nullDevice, 'w'],
                2 => ['file', $nullDevice, 'w'],
            ],
            $pipes,
        );
        if (is_resource($killer)) {
            proc_close($killer);
        }
        return;
    }

    proc_terminate($process);
    $graceDeadline = microtime(true) + 2;
    while (proc_get_status($process)['running'] && microtime(true) < $graceDeadline) {
        usleep(100_000);
    }
    if (proc_get_status($process)['running']) {
        proc_terminate($process, 9);
    }
}

/** @param list<string> $command */
function display_command(array $command): string
{
    return implode(
        ' ',
        array_map(
            static fn (string $argument): string =>
                preg_match('/^[A-Za-z0-9_.\-\/:=@]+$/', $argument) === 1
                    ? $argument
                    : escapeshellarg($argument),
            $command,
        ),
    );
}

function ensure_directory(string $directory): void
{
    if (!is_dir($directory) && !mkdir($directory, 0777, true) && !is_dir($directory)) {
        throw new RuntimeException("could not create artifact directory: {$directory}");
    }
}

function remove_generated_directory(string $directory, string $allowedRoot): void
{
    if (!is_dir($directory)) {
        return;
    }

    $resolvedRoot = realpath($allowedRoot);
    $resolvedDirectory = realpath($directory);
    if (
        $resolvedRoot === false
        || $resolvedDirectory === false
        || !str_starts_with($resolvedDirectory, $resolvedRoot . DIRECTORY_SEPARATOR)
    ) {
        throw new RuntimeException("refusing to remove unexpected build directory: {$directory}");
    }

    $entries = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($resolvedDirectory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST,
    );
    foreach ($entries as $entry) {
        $path = $entry->getPathname();
        $removed = $entry->isDir() && !$entry->isLink() ? rmdir($path) : unlink($path);
        if (!$removed) {
            throw new RuntimeException("could not remove stale build output: {$path}");
        }
    }
    if (!rmdir($resolvedDirectory)) {
        throw new RuntimeException("could not remove stale build directory: {$resolvedDirectory}");
    }
}

function remove_stale_artifacts(string $pattern): void
{
    foreach (glob($pattern) ?: [] as $file) {
        if (is_file($file) && !unlink($file)) {
            throw new RuntimeException("could not remove stale artifact: {$file}");
        }
    }
}

function require_artifact(string $path, string $label): void
{
    if (!is_file($path)) {
        throw new RuntimeException("{$label} was not found at {$path}");
    }

    $resolved = realpath($path) ?: $path;
    fwrite(STDOUT, "\n{$label}: {$resolved}\n");
}

function print_usage(): void
{
    fwrite(STDOUT, <<<'USAGE'
Build the ++PHP language server and editor artifacts from the repository root.

Usage:
  php scripts/build.php <target>

Targets:
  server             Build the editor-neutral language-server bundle
  vscode-extension   Build the unpackaged VS Code extension and bundled server
  vscode             Build the installable VS Code VSIX
  phpstorm           Build and test the installable PhpStorm plugin ZIP
  editors            Build both installable editor packages
  all                Build both installable editor packages
  help               Show this help

Every packaging target removes its previous artifact and prints the absolute path
of each artifact produced by the current build. Node.js build targets validate the
root workspace installation and run npm ci automatically when locked dependencies
are missing or incompatible with the current platform.
USAGE);
    fwrite(STDOUT, "\n");
}

function usage_error(string $message): never
{
    fwrite(STDERR, "build: {$message}\n\n");
    print_usage();
    exit(2);
}
