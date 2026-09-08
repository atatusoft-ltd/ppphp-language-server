<?php

declare(strict_types=1);

namespace DebuggerSpike;

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new \RuntimeException($message);
    }
}

/** Bounded framed protocol I/O. Never persists debugger payloads. */
final class Protocol
{
    public static function read($stream, int $length): string
    {
        expect($length >= 0 && $length <= 4 * 1024 * 1024, 'Invalid frame length.');
        $data = '';
        while (strlen($data) < $length) {
            $part = fread($stream, $length - strlen($data));
            expect($part !== false && $part !== '', 'Debugger connection closed or timed out.');
            $data .= $part;
        }
        return $data;
    }

    public static function terminated($stream): string
    {
        $data = '';
        while (($byte = self::read($stream, 1)) !== "\0") {
            $data .= $byte;
            expect(strlen($data) < 4 * 1024 * 1024, 'Oversized debugger command.');
        }
        return $data;
    }

    public static function packet($stream): string
    {
        $length = self::terminated($stream);
        expect(ctype_digit($length) && strlen($length) <= 8, 'Invalid debugger frame header.');
        $data = self::read($stream, (int) $length);
        expect(self::read($stream, 1) === "\0", 'Invalid debugger frame trailer.');
        return $data;
    }

    public static function write($stream, string $data): void
    {
        while ($data !== '') {
            $count = fwrite($stream, $data);
            expect($count !== false && $count > 0, 'Debugger write failed.');
            $data = substr($data, $count);
        }
    }

    public static function xml(string $payload): \DOMDocument
    {
        expect(!str_contains(strtoupper($payload), '<!DOCTYPE'), 'DTD is not allowed.');
        $doc = new \DOMDocument();
        expect($doc->loadXML($payload, LIBXML_NONET), 'Invalid debugger XML.');
        return $doc;
    }

    public static function socket(): mixed
    {
        $server = stream_socket_server('tcp://127.0.0.1:0', $code, $error);
        expect($server !== false, 'Could not create loopback debugger listener: ' . $error);
        return $server;
    }

    public static function port($server): int
    {
        return (int) substr(strrchr(stream_socket_get_name($server, false), ':'), 1);
    }
}
