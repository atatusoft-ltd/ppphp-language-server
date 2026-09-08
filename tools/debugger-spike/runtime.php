<?php

declare(strict_types=1);

require __DIR__ . '/SourceMaps.php';
require __DIR__ . '/Protocol.php';
require __DIR__ . '/Process.php';

use DebuggerSpike\Process;
use DebuggerSpike\Protocol;
use DebuggerSpike\SourceMaps;
use function DebuggerSpike\expect;
use function DebuggerSpike\runtime;

[$script, $root, $extension] = $argv;
$root = realpath($root);
$maps = new SourceMaps($root);
$server = Protocol::socket();
$bridge = new Process([PHP_BINARY, __DIR__ . '/bridge.php', $root, (string) Protocol::port($server)]);
$port = json_decode(fgets($bridge->pipes[1]), true, flags: JSON_THROW_ON_ERROR)['port'];
$runtime = runtime(PHP_BINARY, $extension, $root, $port);
$engine = stream_socket_accept($server, 15);
expect($engine !== false, 'No DBGp connection.');
stream_set_timeout($engine, 15);
$init = Protocol::xml(Protocol::packet($engine));
expect(SourceMaps::path($init->documentElement->getAttribute('fileuri')) === $root . '/src/main.php', 'Entry path was not mapped.');
$sequence = 0;
function command(string $command): DOMDocument
{
    global $engine, $sequence;
    $sequence++;
    [$verb, $rest] = array_pad(explode(' ', $command, 2), 2, '');
    Protocol::write($engine, rtrim("$verb -i $sequence $rest") . "\0");
    do {
        $doc = Protocol::xml(Protocol::packet($engine));
    } while ($doc->documentElement->localName !== 'response' || $doc->documentElement->getAttribute('transaction_id') !== (string) $sequence);
    expect($doc->getElementsByTagName('error')->length === 0, 'DBGp command failed: ' . $verb . ' ' . $doc->documentElement->textContent);
    return $doc;
}
function position(): array
{
    $frame = command('stack_get')->getElementsByTagName('stack')->item(0);
    expect($frame !== null, 'Missing stack.');
    return [basename(SourceMaps::path($frame->getAttribute('filename'))), (int) $frame->getAttribute('lineno')];
}
function stopAt(string $verb, string $file, int $line): void
{
    command($verb);
    expect(position() === [$file, $line], "$verb stopped at unexpected source position: " . json_encode(position()));
    echo 'PASS ', $verb, ' -> ', $file, ':', $line, "\n";
}
function value(string $expression): string
{
    $result = command('eval -- ' . base64_encode($expression));
    return $result->getElementsByTagName('property')->item(0)->textContent;
}
command('feature_set -n resolved_breakpoints -v 1');
$breakpoint = command('breakpoint_set -t line -f ' . SourceMaps::uri($root . '/src/Quote.ppphp') . ' -n 9');
$id = $breakpoint->documentElement->getAttribute('id');
expect($id !== '', 'Missing breakpoint ID.');
stopAt('run', 'Quote.ppphp', 9);
$resolved = command('breakpoint_get -d ' . $id)->getElementsByTagName('breakpoint')->item(0);
expect($resolved->getAttribute('resolved') === 'resolved', 'Breakpoint not resolved by Xdebug.');
echo "PASS source breakpoint confirmed executable by Xdebug\n";
command('breakpoint_remove -d ' . $id);
stopAt('step_over', 'Quote.ppphp', 10);
expect(value('$unitPrice') === '100', 'Incorrect local unitPrice.');
stopAt('step_over', 'Quote.ppphp', 11);
expect(value('$subtotal') === '300', 'Incorrect subtotal.');
stopAt('step_into', 'LegacyTax.php', 11);
expect(value('$subtotal') === '300', 'Incorrect native PHP argument.');
stopAt('step_over', 'LegacyTax.php', 12);
expect(value('$tax') === '30', 'Incorrect tax.');
command('step_out');
echo 'OBSERVE step_out -> ', json_encode(position()), "\n";
$branch = command('breakpoint_set -t conditional -f ' . SourceMaps::uri($root . '/src/Quote.ppphp') . ' -n 13 -- ' . base64_encode('$subtotal === 300'));
$branchId = $branch->documentElement->getAttribute('id');
stopAt('run', 'Quote.ppphp', 13);
expect(value('$tax') === '30', 'Conditional branch breakpoint has wrong scope.');
command('breakpoint_remove -d ' . $branchId);
echo "PASS conditional breakpoint inside a lowered when branch\n";
$trace = [];
for ($step = 0; $step < 30; $step++) {
    $location = position();
    if ($location === ['Quote.ppphp', 17]) {
        break;
    }
    $trace[] = $location;
    command('step_over');
}
expect(position() === ['Quote.ppphp', 17], 'Did not finish lowered when.');
expect(value('$discount') === '25', 'Wrong when result.');
echo 'OBSERVE lowered when source stops: ', json_encode($trace), "\n";
stopAt('step_over', 'Quote.ppphp', 18);
expect(value('$total') === '305', 'Wrong total.');
echo "PASS original locals and PHP watch evaluation: subtotal=300 tax=30 discount=25 total=305\n";
command('breakpoint_set -t exception -x RuntimeException');
stopAt('run', 'Quote.ppphp', 19);
expect(value('$quantity') === '0', 'Exception was not second invocation.');
echo "PASS exception stop maps to original throw\n";
command('run');
command('stop');
echo 'PASS runtime output: ', json_encode($runtime->finish()), "\n";
fclose($engine);
fclose($server);
[$file, $branchCandidates] = $maps->generated($root . '/src/Quote.ppphp', 13);
echo 'OBSERVE branch-return breakpoint candidates: ', json_encode($branchCandidates), "\n";
expect($branchCandidates !== [], 'Branch-return mapping was lost.');
echo "PASS branch-return location recovered from existing line-start map\n";
