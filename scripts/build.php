#!/usr/bin/env php
<?php

declare(strict_types=1);

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
    $artifact = $root . '/packages/language-server/dist/server.cjs';
    remove_stale_artifacts($artifact);
    run_tool('npm', ['run', 'build', '--workspace', '@ppphp/language-server'], $root);
    require_artifact($artifact, 'language-server bundle');
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
function run_tool(string $tool, array $arguments, string $workingDirectory): void
{
    $command = PHP_OS_FAMILY === 'Windows'
        ? windows_command($tool, $arguments)
        : [$tool, ...$arguments];
    run_command($command, $workingDirectory);
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
function run_command(array $command, string $workingDirectory): void
{
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

    $status = proc_close($process);
    if ($status !== 0) {
        throw new RuntimeException(
            "command failed with exit code {$status}: " . display_command($command),
        );
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
of each artifact produced by the current build.
USAGE);
    fwrite(STDOUT, "\n");
}

function usage_error(string $message): never
{
    fwrite(STDERR, "build: {$message}\n\n");
    print_usage();
    exit(2);
}
