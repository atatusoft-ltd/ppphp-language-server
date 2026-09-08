<?php

declare(strict_types=1);

namespace DebuggerSpike;

/** Experimental consumer of production maps; NOT a compiler debug-metadata contract. */
final class SourceMaps
{
    private array $files = [];
    private array $hashes = [];

    public function __construct(public readonly string $root)
    {
        $manifestPath = $root . '/build/.ppphp/manifest.json';
        $manifest = self::readJson($manifestPath);
        if (($manifest['formatVersion'] ?? null) !== 2 || ($manifest['completeProject'] ?? null) !== true) {
            throw new \RuntimeException('A complete supported build is required.');
        }
        $this->hashes[$manifestPath] = hash_file('sha256', $manifestPath);
        foreach ($manifest['files'] as $entry) {
            $source = self::inside($root, $entry['source']);
            $output = self::inside($root . '/build', $entry['output']);
            if (!str_starts_with($entry['sourceMap'], '.ppphp/source-maps/')) {
                throw new \RuntimeException('Invalid source-map location.');
            }
            $mapPath = self::inside($root . '/build', $entry['sourceMap']);
            $map = self::readJson($mapPath);
            $original = file_get_contents($source);
            $generated = file_get_contents($output);
            if (($map['formatVersion'] ?? null) !== 1
                || $map['source'] !== $entry['source'] || $map['generated'] !== $entry['output']
                || $entry['sourceHash'] !== 'sha256:' . hash('sha256', $original)
                || $entry['outputHash'] !== 'sha256:' . hash('sha256', $generated)
                || $map['sourceHash'] !== $entry['sourceHash'] || $map['generatedHash'] !== $entry['outputHash']
                || $map['generatedLength'] !== strlen($generated)) {
                throw new \RuntimeException('Stale or unsupported source map. Rebuild before debugging.');
            }
            $end = 0;
            foreach ($map['segments'] as $segment) {
                if ($segment['generatedStart'] !== $end || $segment['generatedEnd'] < $end
                    || $segment['generatedEnd'] > strlen($generated)
                    || $segment['originalStart'] < 0 || $segment['originalEnd'] < $segment['originalStart']
                    || $segment['originalEnd'] > strlen($original)) {
                    throw new \RuntimeException('Invalid source-map segment.');
                }
                $end = $segment['generatedEnd'];
            }
            if ($end !== strlen($generated)) {
                throw new \RuntimeException('Incomplete source map.');
            }
            $lines = [];
            $offset = 0;
            foreach (explode("\n", $generated) as $index => $text) {
                // The compiler deliberately maps generated indentation to a branch result.
                // Skipping whitespace would instead select the synthetic variable's owner.
                $probe = min(strlen($generated) - 1, $offset);
                foreach ($map['segments'] as $segment) {
                    if ($probe < $segment['generatedStart'] || $probe >= $segment['generatedEnd']) {
                        continue;
                    }
                    $origin = $segment['ownerStart'] ?? ($segment['originalStart'] + min(
                        $probe - $segment['generatedStart'], $segment['originalEnd'] - $segment['originalStart'],
                    ));
                    $lines[$index + 1] = substr_count(substr($original, 0, $origin), "\n") + 1;
                    break;
                }
                $offset += strlen($text) + 1;
            }
            $this->files[$source] = ['output' => $output, 'lines' => $lines];
            foreach ([$source, $output, $mapPath] as $path) {
                $this->hashes[$path] = hash_file('sha256', $path);
            }
        }
    }

    public function assertFresh(): void
    {
        foreach ($this->hashes as $path => $hash) {
            if (!is_file($path) || hash_file('sha256', $path) !== $hash) {
                throw new \RuntimeException('Debug snapshot changed. Stop, rebuild and restart.');
            }
        }
    }

    public static function inside(string $root, string $relative): string
    {
        if ($relative === '' || str_contains($relative, '\\') || str_starts_with($relative, '/')
            || in_array('..', explode('/', $relative), true)) {
            throw new \RuntimeException('Unsafe artifact path.');
        }
        $path = realpath($root . '/' . $relative);
        if ($path === false || !str_starts_with($path, realpath($root) . '/')) {
            throw new \RuntimeException('Artifact escapes its root or is missing.');
        }
        return $path;
    }

    public static function readJson(string $path): array
    {
        if (!is_file($path) || filesize($path) > 4 * 1024 * 1024) {
            throw new \RuntimeException('Missing or oversized metadata.');
        }
        return json_decode(file_get_contents($path), true, 64, JSON_THROW_ON_ERROR);
    }

    public static function uri(string $path): string
    {
        return 'file://' . implode('/', array_map('rawurlencode', explode('/', $path)));
    }

    public static function path(string $uri): string
    {
        return preg_replace('~^file://~', '', rawurldecode($uri));
    }

    /** All candidate lines; only the runtime can confirm which are executable. */
    public function generated(string $source, int $line): array
    {
        $file = $this->files[$source] ?? null;
        if ($file === null) {
            throw new \RuntimeException('Source is not owned by this build.');
        }
        return [$file['output'], array_keys($file['lines'], $line, true)];
    }

    public function original(string $output, int $line): array
    {
        foreach ($this->files as $source => $file) {
            if ($file['output'] === $output) {
                return [$source, $file['lines'][$line] ?? $line];
            }
        }
        return [$output, $line];
    }
}
