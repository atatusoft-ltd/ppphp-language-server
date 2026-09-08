<?php

declare(strict_types=1);

// Experimental single-session DBGp bridge. No editor APIs and no Xdebug fork.
require __DIR__ . '/SourceMaps.php';
require __DIR__ . '/Protocol.php';

use DebuggerSpike\Protocol;
use DebuggerSpike\SourceMaps;
use function DebuggerSpike\expect;

try {
    [$script, $root, $editorPort] = $argv;
    $maps = new SourceMaps(realpath($root));
    $server = Protocol::socket();
    echo json_encode(['port' => Protocol::port($server)]), "\n";
    $engine = stream_socket_accept($server, 30);
    expect($engine !== false, 'No runtime connected within 30 seconds.');
    fclose($server);
    $editor = stream_socket_client('tcp://127.0.0.1:' . (int) $editorPort, $code, $error, 10);
    expect($editor !== false, 'Could not reach editor: ' . $error);
    stream_set_timeout($engine, 30);
    stream_set_timeout($editor, 30);
    $deadline = microtime(true) + 120;
    while (microtime(true) < $deadline) {
        $read = [$engine, $editor];
        $write = $except = [];
        $ready = stream_select($read, $write, $except, 1);
        expect($ready !== false, 'Debugger select failed.');
        foreach ($read as $stream) {
            if (feof($stream)) {
                exit(0);
            }
            if ($stream === $editor) {
                $command = Protocol::terminated($editor);
                $maps->assertFresh();
                if (str_starts_with($command, 'breakpoint_set ')
                    && preg_match('/ -f ("[^"]+"|\S+)/', $command, $match)
                    && preg_match('/ -n (\d+)/', $command, $lineMatch)) {
                    $source = SourceMaps::path(trim($match[1], '"'));
                    [$output, $lines] = $maps->generated($source, (int) $lineMatch[1]);
                    expect($lines !== [], 'No generated location for this source breakpoint.');
                    // Intentionally conservative spike: first candidate, with engine resolution.
                    // The report must not present this as a complete executable-location policy.
                    $command = str_replace(' -f ' . $match[1], ' -f ' . SourceMaps::uri($output), $command);
                    $command = preg_replace('/ -n \d+/', ' -n ' . $lines[0], $command, 1);
                }
                Protocol::write($engine, $command . "\0");
            } else {
                $doc = Protocol::xml(Protocol::packet($engine));
                foreach ($doc->getElementsByTagName('*') as $element) {
                    foreach (['filename', 'fileuri'] as $attribute) {
                        if (!$element->hasAttribute($attribute)) {
                            continue;
                        }
                        $lineName = $element->hasAttribute('lineno') ? 'lineno' : 'line';
                        [$source, $line] = $maps->original(
                            SourceMaps::path($element->getAttribute($attribute)),
                            (int) $element->getAttribute($lineName),
                        );
                        $element->setAttribute($attribute, SourceMaps::uri($source));
                        if ($element->hasAttribute($lineName)) {
                            $element->setAttribute($lineName, (string) $line);
                        }
                    }
                }
                $payload = $doc->saveXML();
                Protocol::write($editor, strlen($payload) . "\0" . $payload . "\0");
                if ($doc->documentElement->getAttribute('status') === 'stopped') {
                    exit(0);
                }
            }
        }
    }
    throw new RuntimeException('Spike session deadline exceeded.');
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
