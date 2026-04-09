<?php
declare(strict_types=1);

namespace BlackCat\Auth\Pkce;

final class PkceSession
{
    /**
     * @param list<string> $scopes
     */
    public function __construct(
        public readonly string $code,
        public readonly string $clientId,
        public readonly string $subjectId,
        public readonly string $codeChallenge,
        public readonly string $method,
        public readonly array $scopes,
        public readonly int $issuedAt,
        public readonly int $expiresAt,
    ) {}

    /**
     * @param list<string> $scopes
     */
    public static function issue(string $clientId, string $subjectId, string $codeChallenge, string $method, array $scopes, int $ttl): self
    {
        $method = strtoupper($method ?: 'S256');
        $code = bin2hex(random_bytes(16));
        $now = time();
        return new self($code, $clientId, $subjectId, $codeChallenge, $method, $scopes, $now, $now + max(60, $ttl));
    }

    public function isExpired(): bool
    {
        return $this->expiresAt <= time();
    }
}
