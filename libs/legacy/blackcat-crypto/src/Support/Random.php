<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Support;

final class Random
{
    /**
     * @param int $bytes
     */
    public static function hex(int $bytes): string
    {
        if ($bytes < 1) {
            throw new \InvalidArgumentException('Random::hex expects $bytes >= 1');
        }
        return bin2hex(random_bytes($bytes));
    }
}
