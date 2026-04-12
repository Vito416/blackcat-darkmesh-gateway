<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

use BlackCat\Auth\Config\AuthConfig;

final class OidcMetadataBuilder
{
    /**
     * @return array<string,mixed>
     */
    public static function build(AuthConfig $config): array
    {
        $base = rtrim($config->publicBaseUrl(), '/');
        return [
            'issuer' => $config->issuer(),
            'authorization_endpoint' => $base . '/authorize',
            'token_endpoint' => $base . '/token',
            'userinfo_endpoint' => $base . '/userinfo',
            'jwks_uri' => $base . '/jwks.json',
            'revocation_endpoint' => $base . '/token/revoke',
            'introspection_endpoint' => $base . '/introspect',
            'registration_endpoint' => $base . '/clients/register',
            'response_types_supported' => ['code', 'token'],
            'grant_types_supported' => ['authorization_code', 'refresh_token', 'client_credentials', 'password'],
            'code_challenge_methods_supported' => ['S256', 'plain'],
            'scopes_supported' => ['openid', 'profile', 'email', 'offline_access'],
            'token_endpoint_auth_methods_supported' => ['client_secret_post', 'client_secret_basic'],
            'claims_supported' => ['sub', 'email', 'email_verified', 'roles', 'scopes'],
        ];
    }
}
