#!/usr/bin/env php
<?php

declare(strict_types=1);

$repositoryRoot = dirname(__DIR__);

try {
    $canonicalVersion = trim(read_text($repositoryRoot, 'VERSION'));
    if (
        preg_match('/^[1-9]\d{3}\.[1-4]\.[1-9]\d*$/D', $canonicalVersion) !== 1
        || (float) explode('.', $canonicalVersion)[2] > 2147483647
    ) {
        fail('VERSION must use numeric tooling CalVer YYYY.Q.R without compiler channel suffixes.');
    }
    $compilerVersion = trim(read_text($repositoryRoot, 'COMPILER_VERSION'));
    if (
        preg_match(
            '/^(?:dev-\d{4}\.[1-4]\.[1-9]\d*|\d{4}\.[1-4]\.[1-9]\d*(?:-rc-[1-9]\d*)?)$/D',
            $compilerVersion,
        ) !== 1
    ) {
        fail(
            'COMPILER_VERSION must use canonical ++PHP compiler CalVer, received '
                . json_encode($compilerVersion, JSON_THROW_ON_ERROR),
        );
    }

    $manifestExpectations = [
        ['package.json', false],
        ['packages/language-server/package.json', true],
        ['editors/vscode/package.json', true],
        ['res/textmate/ppphp/package.json', true],
    ];

    foreach ($manifestExpectations as [$file, $carriesCompilerVersion]) {
        $manifest = read_json($repositoryRoot, $file);
        expect_equal("{$file} version", $manifest['version'] ?? null, $canonicalVersion);
        if ($carriesCompilerVersion) {
            expect_equal(
                "{$file} ppphpToolchainVersion",
                $manifest['ppphpToolchainVersion'] ?? null,
                $compilerVersion,
            );
        }
    }

    $lockfile = read_json($repositoryRoot, 'package-lock.json');
    expect_equal('package-lock.json version', $lockfile['version'] ?? null, $canonicalVersion);
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

    if (getenv('GITHUB_REF_TYPE') === 'tag') {
        expect_equal('release tag', getenv('GITHUB_REF_NAME'), 'v' . $canonicalVersion);
    }

    fwrite(STDOUT, "Version metadata is consistent: tooling {$canonicalVersion}, compiler {$compilerVersion}.\n");
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
