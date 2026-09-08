<?php

declare(strict_types=1);

namespace DebuggerSpike;

final class Process
{
    public mixed $handle = null;
    public array $pipes = [];

    public function __construct(array $command, ?string $cwd = null)
    {
        $this->handle = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $this->pipes, $cwd);
        expect(is_resource($this->handle), 'Could not launch child process.');
        foreach ($this->pipes as $pipe) {
            stream_set_timeout($pipe, 30);
        }
    }

    public function finish(int $seconds = 10): string
    {
        $output = $error = '';
        foreach ([1, 2] as $index) {
            stream_set_blocking($this->pipes[$index], false);
        }
        $deadline = microtime(true) + $seconds;
        do {
            $output .= stream_get_contents($this->pipes[1]);
            $error .= stream_get_contents($this->pipes[2]);
            expect(strlen($output) + strlen($error) < 1024 * 1024, 'Child output limit exceeded.');
            $status = proc_get_status($this->handle);
            if (!$status['running']) {
                // The child may have written its last bytes after the preceding reads.
                $output .= stream_get_contents($this->pipes[1]);
                $error .= stream_get_contents($this->pipes[2]);
                expect(strlen($output) + strlen($error) < 1024 * 1024, 'Child output limit exceeded.');
                expect($status['exitcode'] === 0, 'Child failed: ' . $error);
                return $output;
            }
            usleep(10000);
        } while (microtime(true) < $deadline);
        throw new \RuntimeException('Child process did not finish.');
    }

    public function __destruct()
    {
        if (is_resource($this->handle)) {
            if (proc_get_status($this->handle)['running']) {
                proc_terminate($this->handle);
            }
            foreach ($this->pipes as $pipe) {
                if (is_resource($pipe)) {
                    fclose($pipe);
                }
            }
            proc_close($this->handle);
        }
    }
}

function runtime(string $php, string $extension, string $root, int $port): Process
{
    return new Process([
        $php, '-d', 'zend_extension=' . $extension,
        '-d', 'xdebug.mode=debug', '-d', 'xdebug.start_with_request=yes',
        '-d', 'xdebug.client_host=127.0.0.1', '-d', 'xdebug.client_port=' . $port,
        '-d', 'xdebug.discover_client_host=0', '-d', 'xdebug.log_level=0',
        $root . '/build/main.php',
    ], $root);
}
