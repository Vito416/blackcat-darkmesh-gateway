<?php
declare(strict_types=1);

namespace BlackCat\Auth\Token;

final class TokenPair
{
    public function __construct(
        public readonly string $accessToken,
        public readonly string $refreshToken,
        public readonly int $expiresAt,
    ) {}
}
