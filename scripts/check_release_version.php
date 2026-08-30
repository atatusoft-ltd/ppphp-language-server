#!/usr/bin/env php
<?php

declare(strict_types=1);

$repositoryRoot = dirname(__DIR__);

try {
    $canonicalVersion = trim(read_text($repositoryRoot, 'VERSION'));
    if (
        preg_match(
            '/^\d{4}\.[1-4]\.[1-9]\d*(?:-(?:canary|alpha|beta|rc)(?:\.[1-9]\d*)?)?$/D',
            $canonicalVersion,
        ) !== 1
    ) {
        fail(
            'VERSION must use canonical ++PHP CalVer YYYY.Q.patch[-channel], received '
                . json_encode($canonicalVersion, JSON_THROW_ON_ERROR),
        );
    }

    $manifestExpectations = [
        ['package.json', false],
        ['packages/language-server/package.json', true],
        ['editors/vscode/package.json', true],
        ['res/textmate/ppphp/package.json', true],
    ];

    foreach ($manifestExpectations as [$file, $carriesCanonicalVersion]) {
        $manifest = read_json($repositoryRoot, $file);
        expect_equal("{$file} version", $manifest['version'] ?? null, $canonicalVersion);
        if ($carriesCanonicalVersion) {
            expect_equal(
                "{$file} ppphpToolchainVersion",
                $manifest['ppphpToolchainVersion'] ?? null,
                $canonicalVersion,
            );
        }
    }

    $lockfile = read_json($repositoryRoot, 'package-lock.json');
    foreach (['', 'editors/vscode', 'packages/language-server'] as $packagePath) {
        expect_equal(
            'package-lock.json package ' . json_encode($packagePath, JSON_THROW_ON_ERROR) . ' version',
            $lockfile['packages'][$packagePath]['version'] ?? null,
            $canonicalVersion,
        );
    }

    $gradleProperties = read_text($repositoryRoot, 'editors/phpstorm/gradle.properties');
    preg_match('/^pluginVersion=(.+)$/m', $gradleProperties, $pluginVersionMatch);
    expect_equal(
        'editors/phpstorm/gradle.properties pluginVersion',
        $pluginVersionMatch[1] ?? null,
        $canonicalVersion,
    );

    foreach (
        [
            'README.md',
            'docs/releasing.md',
            'editors/vscode/README.md',
            'editors/phpstorm/README.md',
        ] as $file
    ) {
        if (!str_contains(read_text($repositoryRoot, $file), $canonicalVersion)) {
            fail("{$file} must identify the current canonical toolchain version {$canonicalVersion}");
        }
    }

    if (getenv('GITHUB_REF_TYPE') === 'tag') {
        expect_equal('release tag', getenv('GITHUB_REF_NAME'), 'v' . $canonicalVersion);
    }

    fwrite(STDOUT, "Version metadata is consistent: {$canonicalVersion}.\n");
} catch (JsonException | RuntimeException $error) {
    fail($error->getMessage());
}

function read_text(string $root, string $file): string
{
    $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $file);
    $contents = @file_get_contents($path);
    if ($contents === false) {
        throw new RuntimeException("could not read {$file}");
    }

    return $contents;
}

/** @return array<string, mixed> */
function read_json(string $root, string $file): array
{
    $value = json_decode(read_text($root, $file), true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($value)) {
        throw new RuntimeException("{$file} must contain a JSON object");
    }

    return $value;
}

function expect_equal(string $label, mixed $actual, mixed $expected): void
{
    if ($actual !== $expected) {
        fail(
            $label
                . ' must be '
                . json_encode($expected, JSON_THROW_ON_ERROR)
                . ', received '
                . json_encode($actual, JSON_THROW_ON_ERROR),
        );
    }
}

function fail(string $message): never
{
    fwrite(STDERR, "{$message}\n");
    exit(1);
}
