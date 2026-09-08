#!/usr/bin/env php
<?php

declare(strict_types=1);

$root = dirname(__DIR__);

try {
    foreach (['Phar', 'SimpleXML'] as $extension) {
        if (!extension_loaded($extension)) {
            throw new RuntimeException("VSIX verification requires the PHP {$extension} extension.");
        }
    }
    $archive = new PharData($argv[1] ?? $root . '/build/ppphp-vscode.vsix');
    $manifest = json_decode($archive['extension/package.json']->getContent(), true, 512, JSON_THROW_ON_ERROR);
    $source = json_decode(file_get_contents($root . '/editors/vscode/package.json'), true, 512, JSON_THROW_ON_ERROR);
    $version = trim(file_get_contents($root . '/VERSION'));
    $compiler = trim(file_get_contents($root . '/COMPILER_VERSION'));
    if (
        ($manifest['version'] ?? null) !== $version
        || ($manifest['ppphpToolchainVersion'] ?? null) !== $compiler
        || ($manifest['publisher'] ?? null) !== $source['publisher']
        || ($manifest['name'] ?? null) !== $source['name']
    ) {
        throw new RuntimeException('VSIX package metadata does not match tooling/compiler/publisher identities.');
    }
    $xml = simplexml_load_string($archive['extension.vsixmanifest']->getContent(), options: LIBXML_NONET);
    if ($xml === false) throw new RuntimeException('VSIX manifest is invalid XML.');
    $xml->registerXPathNamespace('v', 'http://schemas.microsoft.com/developer/vsx-schema/2011');
    $identities = $xml->xpath('/v:PackageManifest/v:Metadata/v:Identity');
    if (
        count($identities) !== 1
        || (string) $identities[0]['Version'] !== $version
        || (string) $identities[0]['Publisher'] !== $source['publisher']
        || (string) $identities[0]['Id'] !== $source['name']
    ) {
        throw new RuntimeException('VSIX XML identity does not match its package metadata.');
    }
    if ($xml->xpath('//v:Property[@Id="Microsoft.VisualStudio.Code.PreRelease"]') !== []) {
        throw new RuntimeException('Compiler candidate metadata must not mark the extension as pre-release.');
    }
    fwrite(STDOUT, "VSIX release, compiler compatibility, publisher and channel metadata match.\n");
} catch (Throwable $error) {
    fwrite(STDERR, 'VSIX validation: ' . $error->getMessage() . "\n");
    exit(1);
}
