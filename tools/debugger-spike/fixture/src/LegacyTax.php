<?php

declare(strict_types=1);

namespace DebuggerSpike;

final class LegacyTax
{
    public static function calculate(int $subtotal): int
    {
        $tax = intdiv($subtotal, 10); // BREAK:legacy
        return $tax; // BREAK:legacyReturn
    }
}
