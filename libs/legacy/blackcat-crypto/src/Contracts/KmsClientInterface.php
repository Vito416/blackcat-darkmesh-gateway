<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Contracts;

use BlackCat\Crypto\Support\Payload;

interface KmsClientInterface
{
    public function id(): string;

    /** @return array<string,mixed> */
    public function wrap(string $context, Payload $payload): array;

    /** @param array<string,mixed> $metadata */
    public function unwrap(string $context, array $metadata): Payload;

    /** @return array<string,mixed> */
    public function health(): array;
}
