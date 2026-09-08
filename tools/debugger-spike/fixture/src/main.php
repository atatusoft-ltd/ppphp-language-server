<?php

declare(strict_types=1);

require __DIR__ . '/LegacyTax.php';
require __DIR__ . '/Quote.php';

$quote = new \DebuggerSpike\Quote();
echo $quote->calculate(3), "\n";
try {
    $quote->calculate(0);
} catch (\RuntimeException $error) {
    echo $error->getMessage(), "\n"; // BREAK:catch
}
