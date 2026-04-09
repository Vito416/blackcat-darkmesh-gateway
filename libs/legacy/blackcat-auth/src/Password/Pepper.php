<?php
declare(strict_types=1);

namespace BlackCat\Auth\Password;

final class Pepper
{
    public function __construct(
        private string $bytes,
        public readonly string $version,
    ) {}

    public function bytes(): string
    {
        return $this->bytes;
    }

    public function release(): void
    {
        $len = strlen($this->bytes);

        if (function_exists('sodium_memzero')) {
            $copy = $this->bytes;
            @sodium_memzero($copy);
        }

        $this->bytes = str_repeat("\0", $len);
    }
}
