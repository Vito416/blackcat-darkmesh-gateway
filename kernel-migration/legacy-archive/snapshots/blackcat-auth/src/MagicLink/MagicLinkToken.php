<?php
declare(strict_types=1);

namespace BlackCat\Auth\MagicLink;

final class MagicLinkToken
{
    /**
     * @param array<string,mixed> $context
     */
    public function __construct(
        public readonly string $fingerprint,
        public readonly string $subject,
        public readonly array $context,
        public readonly int $expiresAt,
    ) {}

    public function isExpired(): bool
    {
        return $this->expiresAt <= time();
    }
}
