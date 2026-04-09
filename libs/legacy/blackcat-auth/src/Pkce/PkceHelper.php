<?php
declare(strict_types=1);

namespace BlackCat\Auth\Pkce;

final class PkceHelper
{
    public static function verify(string $challenge, string $verifier, string $method): bool
    {
        $method = strtoupper($method ?: 'S256');
        if ($method === 'PLAIN') {
            return hash_equals($challenge, $verifier);
        }
        $encoded = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        return hash_equals($challenge, $encoded);
    }

    public static function challengeFromVerifier(string $verifier): string
    {
        return rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    }
}
