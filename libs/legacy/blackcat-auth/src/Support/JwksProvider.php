<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

use BlackCat\Auth\Config\AuthConfig;

final class JwksProvider
{
    /**
     * @return array<string,mixed>
     */
    public static function fromConfig(AuthConfig $config): array
    {
        $secret = $config->signingKey();
        return [
            'keys' => [[
                'kty' => 'oct',
                'kid' => substr(hash('sha256', $secret), 0, 16),
                'alg' => 'HS512',
                'use' => 'sig',
                'k' => self::base64Url($secret),
            ]],
        ];
    }

    private static function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
