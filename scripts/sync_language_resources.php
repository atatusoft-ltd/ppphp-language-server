#!/usr/bin/env php
<?php

declare(strict_types=1);

$repositoryRoot = dirname(__DIR__);
$sourceRoot = $repositoryRoot . '/res/textmate/ppphp';
$targetRoot = $repositoryRoot . '/editors/vscode';
$mappings = [
    ['language-configuration.json', 'language-configuration.json'],
    ['syntaxes/ppphp.tmLanguage.json', 'syntaxes/ppphp.tmLanguage.json'],
];
$arguments = array_slice($argv, 1);

if ($arguments !== [] && $arguments !== ['--check']) {
    fwrite(STDERR, "usage: php scripts/sync_language_resources.php [--check]\n");
    exit(2);
}

$checkOnly = $arguments === ['--check'];
$different = false;

try {
    foreach ($mappings as [$sourceName, $targetName]) {
        $source = $sourceRoot . '/' . $sourceName;
        $target = $targetRoot . '/' . $targetName;

        if ($checkOnly) {
            $sourceContents = read_required_file($source);
            $targetContents = is_file($target) ? read_required_file($target) : null;
            if ($targetContents === null || $sourceContents !== $targetContents) {
                fwrite(STDERR, "{$targetName} is stale; run npm run sync:resources.\n");
                $different = true;
            }
            continue;
        }

        ensure_directory(dirname($target));
        if (!copy($source, $target)) {
            throw new RuntimeException("could not copy {$sourceName} to {$targetName}");
        }
    }
} catch (RuntimeException $error) {
    fwrite(STDERR, "resource sync: {$error->getMessage()}\n");
    exit(1);
}

if ($different) {
    exit(1);
}

fwrite(
    STDOUT,
    $checkOnly
        ? "VS Code language resources match the canonical ++PHP resources.\n"
        : "Synchronized canonical ++PHP resources into the VS Code extension.\n",
);

function read_required_file(string $path): string
{
    $contents = @file_get_contents($path);
    if ($contents === false) {
        throw new RuntimeException("could not read {$path}");
    }

    return $contents;
}

function ensure_directory(string $directory): void
{
    if (!is_dir($directory) && !mkdir($directory, 0777, true) && !is_dir($directory)) {
        throw new RuntimeException("could not create directory {$directory}");
    }
}
