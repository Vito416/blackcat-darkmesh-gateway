<?php
declare(strict_types=1);

namespace BlackCat\Auth\Middleware;

final class AuthResult
{
    /**
     * @param array<string,mixed>|null $claims
     */
    public function __construct(
        public readonly bool $authorized,
        public readonly ?array $claims,
        public readonly ?string $reason = null,
    ) {}
}
