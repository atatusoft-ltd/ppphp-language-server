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
    if (PHP_OS_FAMILY === 'Windows' && str_starts_with($repositoryRoot, '\\\\')) {
        run_windows_unc_build($repositoryRoot, $target);
        exit(0);
    }
    match ($target) {
        'server' => build_server($repositoryRoot),
        'server-release' => package_server($repositoryRoot),
        'zed-grammar' => generate_zed_grammar($repositoryRoot),
        'vscode-extension' => build_vscode_extension($repositoryRoot),
        'vscode' => package_vscode($repositoryRoot),
        'phpstorm' => build_phpstorm($repositoryRoot),
        'zed' => build_zed($repositoryRoot),
        'zed-check' => check_zed($repositoryRoot),
        'zed-dev' => stage_zed_dev($repositoryRoot),
        'editors', 'all' => build_editors($repositoryRoot),
        'help', '--help', '-h' => print_usage(),
        default => usage_error("unknown target '{$target}'"),
    };
} catch (Throwable $error) {
    fwrite(STDERR, "build: {$error->getMessage()}\n");
    exit(1);
}

/**
 * cmd.exe and npm lifecycle scripts cannot use a UNC current directory. Re-enter
 * PHP through pushd's temporary drive so every child (including npm and Gradle)
 * receives a drive-qualified repository path. popd releases it even on failure.
 */
function run_windows_unc_build(string $root, string $target): void
{
    if (preg_match('/\A[a-z-]+\z/D', $target) !== 1) {
        usage_error('invalid build target');
    }
    $temporary = tempnam(sys_get_temp_dir(), 'ppphp-build-');
    if ($temporary === false) {
        throw new RuntimeException('could not create the Windows build launcher');
    }
    $batch = $temporary . '.cmd';
    try {
        if (!rename($temporary, $batch)) {
            throw new RuntimeException('could not prepare the Windows build launcher');
        }
        $quote = static function (string $path): string {
            if (strpbrk($path, "\"\r\n\0") !== false) {
                throw new RuntimeException('unsupported character in Windows build path');
            }
            return '"' . str_replace('%', '%%', $path) . '"';
        };
        $source = "@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\n"
            . 'pushd ' . $quote($root) . "\r\n"
            . "if errorlevel 1 exit /b 1\r\n"
            . $quote(PHP_BINARY) . ' scripts\\build.php ' . $target . "\r\n"
            . "set \"PPPHP_BUILD_EXIT=%ERRORLEVEL%\"\r\n"
            . "popd\r\nexit /b %PPPHP_BUILD_EXIT%\r\n";
        if (file_put_contents($batch, $source) === false) {
            throw new RuntimeException('could not write the Windows build launcher');
        }
        fwrite(STDOUT, "Using a temporary Windows drive for the UNC checkout.\n");
        run_command(windows_command($batch, []), sys_get_temp_dir());
    } finally {
        foreach ([$temporary, $batch] as $path) {
            if (is_file($path)) {
                unlink($path);
            }
        }
    }
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
    run_command([PHP_BINARY, $root . '/scripts/check_vscode_package.php', $artifact], $root);
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

function package_server(string $root): void
{
    run_command([PHP_BINARY, $root . '/scripts/check_release_version.php'], $root);
    build_server($root);
    $version = trim(file_get_contents($root . '/VERSION'));
    $directory = $root . '/build/server-release';
    remove_generated_directory($directory, $root . '/build');
    ensure_directory($directory);
    $name = "ppphp-language-server-{$version}.cjs";
    copy_required_file($root . '/packages/language-server/dist/server.cjs', $directory . '/' . $name);
    copy_required_file($root . '/LICENSE', $directory . '/LICENSE');
    $digest = hash_file('sha256', $directory . '/' . $name);
    if ($digest === false || file_put_contents($directory . '/SHA256SUMS', "{$digest}  {$name}\n") === false) {
        throw new RuntimeException('could not checksum the language-server release');
    }
    require_artifact($directory . '/' . $name, 'versioned language-server release');
    // Exercise the packaged bytes in an empty project, outside this checkout.
    // The Node process must not depend on repository-relative modules or paths.
    $previous = getenv('PPPHP_TEST_SERVER_BUNDLE');
    putenv('PPPHP_TEST_SERVER_BUNDLE=' . $directory . '/' . $name);
    try {
        run_tool('npm', ['exec', '--', 'vitest', 'run', '--root', 'packages/language-server',
            'test/zed-stdio.test.ts'], $root);
    } finally {
        putenv($previous === false ? 'PPPHP_TEST_SERVER_BUNDLE' : 'PPPHP_TEST_SERVER_BUNDLE=' . $previous);
    }
    fwrite(STDOUT, "Publish this asset on GitHub release v{$version} before publishing the Zed extension.\n");
}

function generate_zed_grammar(string $root): void
{
    ensure_node_dependencies($root);
    $cli = $root . '/node_modules/.bin/tree-sitter' . (PHP_OS_FAMILY === 'Windows' ? '.cmd' : '');
    run_tool($cli, ['generate'], $root . '/grammars/ppphp');
}

function zed_target_directory(string $root): string
{
    if (PHP_OS_FAMILY === 'Windows') {
        $localData = getenv('LOCALAPPDATA');
        if ($localData === false || $localData === '') {
            throw new RuntimeException('LOCALAPPDATA is required for short Windows Cargo build paths');
        }
        // Covers zed-check, zed, editors, and all: native build-script objects
        // must not be linked below a long checkout or WSL UNC source directory.
        return $localData . '/ppphp/zed-build/target';
    }
    return $root . '/editors/zed/target';
}

function check_zed(string $root): void
{
    $editor = $root . '/editors/zed';
    run_command([PHP_BINARY, $root . '/scripts/check_release_version.php'], $root);
    run_tool('cargo', ['fmt', '--all', '--', '--check'], $editor);
    run_tool('cargo', ['test', '--locked', '--target-dir', zed_target_directory($root)], $editor);
}

function build_zed(string $root): void
{
    check_zed($root);
    build_server($root);
    $editor = $root . '/editors/zed';
    $artifact = $editor . '/extension.wasm';
    remove_stale_artifacts($artifact);
    // Use one explicit location for both Cargo and the artifact copy, regardless
    // of build.target-dir in local/global Cargo configuration.
    $targetDirectory = zed_target_directory($root);
    run_tool(
        'cargo',
        [
            'build', '--locked', '--release', '--target', 'wasm32-wasip2',
            '--target-dir', $targetDirectory,
        ],
        $editor,
    );
    copy_required_file(
        $targetDirectory . '/wasm32-wasip2/release/ppphp_zed.wasm',
        $artifact,
    );
    require_artifact($artifact, 'Zed extension Wasm');
    fwrite(STDOUT, "\nIn Zed, run 'zed: install dev extension' and select {$editor}.\n");
}

/**
 * Zed explicitly builds into <extension>/target. A short native source copy
 * avoids MSVC linker path limits when the repository lives on a long WSL UNC path.
 */
function stage_zed_dev(string $root): void
{
    $source = $root . '/editors/zed';
    if (PHP_OS_FAMILY === 'Windows') {
        $localData = getenv('LOCALAPPDATA');
        if ($localData === false || $localData === '' || !is_dir($localData)) {
            throw new RuntimeException('LOCALAPPDATA must identify an existing Windows directory');
        }
        $destination = $localData . '/ppphp/zed-dev';
    } else {
        $destination = $root . '/build/zed-dev';
    }

    $marker = $destination . '/.ppphp-generated';
    $markerContents = "Generated by ppphp-language-server zed-dev. Edit the repository source.\n";
    if (file_exists($destination)) {
        if (is_link($destination) || @file_get_contents($marker) !== $markerContents) {
            throw new RuntimeException("refusing to replace an unmanaged directory: {$destination}");
        }
    } else {
        ensure_directory($destination);
        if (file_put_contents($marker, $markerContents) === false) {
            throw new RuntimeException("could not mark generated directory: {$destination}");
        }
    }

    // Replace source directories to remove deleted queries/modules. Keep Zed's
    // target and grammar caches, which can be expensive to rebuild.
    foreach (['src', 'languages'] as $directory) {
        if (!is_dir($source . '/' . $directory)) {
            throw new RuntimeException("missing Zed source directory: {$directory}");
        }
        remove_generated_directory($destination . '/' . $directory, $destination);
        $entries = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($source . '/' . $directory, FilesystemIterator::SKIP_DOTS),
        );
        foreach ($entries as $entry) {
            if ($entry->isLink()) {
                throw new RuntimeException("Zed source must not contain symlinks: {$entry->getPathname()}");
            }
            if ($entry->isFile()) {
                $relative = substr($entry->getPathname(), strlen($source) + 1);
                copy_required_file($entry->getPathname(), $destination . '/' . $relative);
            }
        }
    }
    foreach (['Cargo.toml', 'Cargo.lock', 'extension.toml', 'README.md'] as $file) {
        copy_required_file($source . '/' . $file, $destination . '/' . $file);
    }
    copy_required_file($root . '/LICENSE', $destination . '/LICENSE');
    $resolved = realpath($destination) ?: $destination;
    fwrite(STDOUT, "\nZed development source: {$resolved}\n");
    fwrite(STDOUT, "In Zed, run 'zed: install dev extension' and select this directory.\n");
    fwrite(STDOUT, "Re-run zed-dev after editing the repository. Build/configure the server on your project host.\n");
}

function build_editors(string $root): void
{
    package_vscode($root);
    build_phpstorm($root);
    build_zed($root);
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
    return PHP_OS_FAMILY === 'Windows' && $tool !== 'cargo'
        ? windows_command($tool, $arguments)
        : [$tool, ...$arguments];
}

/**
 * @param list<string> $arguments
 * @return list<string>
 */
function windows_command(string $executable, array $arguments): array
{
    // Resolve PATH shims before cmd.exe so npm can locate its adjacent runtime
    // from the script's absolute path, including under a temporary UNC drive.
    if (!str_contains($executable, '/') && !str_contains($executable, '\\')) {
        $extensions = pathinfo($executable, PATHINFO_EXTENSION) !== ''
            ? ['']
            : explode(';', getenv('PATHEXT') ?: '.COM;.EXE;.BAT;.CMD');
        foreach (explode(';', getenv('PATH') ?: '') as $directory) {
            $directory = trim($directory, '" ');
            if ($directory === '') {
                continue;
            }
            foreach ($extensions as $extension) {
                $candidate = $directory . '\\' . $executable . $extension;
                if (is_file($candidate)) {
                    $executable = $candidate;
                    break 2;
                }
            }
        }
    }
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
  server-release     Package a versioned standalone server and checksum
  vscode-extension   Build the unpackaged VS Code extension and bundled server
  vscode             Build the installable VS Code VSIX
  phpstorm           Build and test the installable PhpStorm plugin ZIP
  zed                Test and build the Zed Wasm extension and local server
  zed-check          Check Rust formatting, adapter tests, and grammar queries
  zed-dev            Stage dev-extension source (short local path on Windows)
  zed-grammar        Regenerate the native ++PHP Tree-sitter parser
  editors            Build all editor artifacts
  all                Build all editor artifacts
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
