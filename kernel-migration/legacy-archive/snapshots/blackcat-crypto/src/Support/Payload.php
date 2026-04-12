<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Support;

final class Payload
{
    /** @param array<string,mixed> $meta */
    public function __construct(
        public readonly string $ciphertext,
        public readonly string $nonce,
        public readonly ?string $keyId = null,
        public readonly array $meta = [],
    ) {}
}
