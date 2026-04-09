<?php

declare(strict_types=1);

return [
    'config_profile' => [
        'file' => dirname(__DIR__) . '/../blackcat-config/config/profiles.php',
        'environment' => 'development',
    ],
    'auth' => [
        'issuer' => 'https://auth.blackcat.local',
        'audience' => 'blackcat-clients',
        'signing_key' => '${env:BLACKCAT_AUTH_SIGNING_KEY}',
        'access_ttl' => 900,
        'refresh_ttl' => 604800,
        'public_base_url' => 'https://auth.blackcat.local',
        'pkce_window' => 300,
        'session' => [
            'ttl' => 3600,
            'store' => [
                'type' => 'database',
                // 'type' => 'redis',
                // 'uri' => 'tcp://redis:6379',
                // 'prefix' => 'auth:sessions',
            ],
        ],
        'magic_link' => [
            'ttl' => 900,
            'url' => 'https://auth.blackcat.local/magic-login',
            // Dev convenience only: return token/link in /magic-link/request response.
            'dev_return_token' => true,
            // Throttling for /magic-link/request (best practice: per-IP + per-email).
            'throttle' => [
                'window_sec' => 300,
                'max_per_ip' => 100,
                'max_per_email' => 5,
            ],
        ],
        // Optional: enable WebAuthn endpoints.
        // 'webauthn' => [
        //     'rp_id' => 'auth.blackcat.local',
        //     'rp_name' => 'BlackCat Auth',
        //     // Challenge TTL in seconds (default 600).
        //     'challenge_ttl' => 600,
        // ],
        'events' => [
            'buffer_size' => 200,
            'webhooks' => [],
        ],
        'registration' => [
            // Default: require email verification (users.is_active stays false until verified).
            'require_email_verification' => true,
            // Token TTL in seconds.
            'email_verification_ttl' => 86400,
            // Optional: build a FE link. Use {token} placeholder.
            'email_verification_link_template' => 'https://app.blackcat.local/verify-email?token={token}',
            // Dev convenience only: return verification_token in /register + /verify-email/resend responses.
            'dev_return_verification_token' => true,
            'password_min_length' => 8,
            // Throttling for /verify-email/resend (best practice: per-IP + per-email).
            'verify_email_resend_throttle' => [
                'window_sec' => 300,
                'max_per_ip' => 50,
                'max_per_email' => 3,
            ],
        ],
        'password_reset' => [
            // Token TTL in seconds.
            'ttl' => 3600,
            // Optional: build a FE link. Use {token} placeholder.
            'link_template' => 'https://app.blackcat.local/reset-password?token={token}',
            // Dev convenience only: return reset_token in /password-reset/request response.
            'dev_return_token' => true,
            // Throttling for /password-reset/request (best practice: per-IP + per-email).
            'throttle' => [
                'window_sec' => 300,
                'max_per_ip' => 50,
                'max_per_email' => 3,
            ],
        ],
        'roles' => [
            'admin' => ['permissions' => ['*']],
            'service' => ['permissions' => ['tokens:create']],
            'customer' => ['permissions' => []],
        ],
        'clients' => [
            'service-api' => [
                'secret' => '${env:BLACKCAT_SERVICE_API_SECRET}',
                'roles' => ['service'],
                'scopes' => ['sync'],
            ],
        ],
    ],
    'user_store' => [
        'driver' => 'database',
        // mysql:  mysql:host=127.0.0.1;port=3306;dbname=blackcat;charset=utf8mb4
        // pgsql:  pgsql:host=127.0.0.1;port=5432;dbname=blackcat
        'dsn' => '${env:BLACKCAT_AUTH_DB_DSN}',
        'user' => '${env:BLACKCAT_AUTH_DB_USER}',
        'pass' => '${env:BLACKCAT_AUTH_DB_PASS}',
        // Security-critical pepper comes from `blackcat-config` runtime config (default key: auth.pepper).
        'pepper_config_key' => 'auth.pepper',
    ],
    // Optional: DB-backed mailing via `blackcat-mailing` (used for email verification).
    // The worker reads SMTP settings from env (see blackcat-mailing/README.md).
    'mailing' => [
        'enabled' => true,
        'app_name' => 'BlackCat Auth',
        'verify_email_template' => 'verify_email',
        'verify_email_priority' => 10,
        'reset_password_template' => 'reset_password',
        'reset_password_priority' => 10,
        'magic_link_template' => 'magic_link',
        'magic_link_priority' => 10,
        // notifications.tenant_id requires an existing tenant (auto_create can seed a default one).
        'tenant' => [
            'slug' => 'default',
            'name' => 'Default tenant',
            'auto_create' => true,
        ],
    ],
    'seed_users' => [
        [
            'email' => 'admin@example.com',
            'password' => 'secret',
            'roles' => ['admin'],
        ],
    ],
    'telemetry' => [
        'prometheus_file' => __DIR__ . '/../var/metrics.prom',
    ],
    'cli' => [
        'default_roles' => ['admin'],
    ],
];
