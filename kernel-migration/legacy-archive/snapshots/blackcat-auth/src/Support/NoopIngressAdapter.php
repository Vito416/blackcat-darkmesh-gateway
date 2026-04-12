<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

use BlackCat\Database\Contracts\DatabaseIngressAdapterInterface;

/**
 * No-op ingress adapter used to prevent double-encryption/double-HMAC when a caller
 * already provides pre-transformed values (e.g. LoginLimiter storing binary hashes).
 */
final class NoopIngressAdapter implements DatabaseIngressAdapterInterface
{
    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    public function encrypt(string $table, array $payload): array
    {
        return $payload;
    }
}

