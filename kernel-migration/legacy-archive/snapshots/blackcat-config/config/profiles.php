<?php

declare(strict_types=1);

return [
    'defaults' => [
        'modules' => ['blackcat-database', 'blackcat-crypto'],
        'env' => [
            'BLACKCAT_CONFIG_VERSION' => '1',
        ],
        'telemetry' => [
            'channel' => 'file://' . dirname(__DIR__) . '/var/log/config-telemetry.ndjson',
        ],
        'integrations' => [
            'installer' => '../blackcat-installer/bin/installer',
            'catalog' => '../blackcat-modules/modules.json',
        ],
        'security' => [
            'requires_tls' => true,
            'required_env' => ['APP_ENV', 'APP_URL'],
        ],
    ],
    'profiles' => [
        'dev' => [
            'environment' => 'development',
        'env_template' => __DIR__ . '/env-templates/development.env',
            'env' => [
                'APP_ENV' => 'dev',
                'DB_DSN' => 'pgsql:host=localhost;dbname=blackcat_dev',
                'APP_URL' => 'https://localhost',
            ],
            'modules' => ['blackcat-database', 'blackcat-messaging'],
            'telemetry' => [
                'channel' => 'file://' . dirname(__DIR__) . '/var/log/config-dev.ndjson',
            ],
            'integrations' => [
                'installer' => '../blackcat-installer/bin/installer',
                'database' => 'blackcat://db',
                'messaging' => '../blackcat-messaging/bin/messaging',
            ],
            'security' => [
                'required_env' => ['DB_DSN', 'APP_URL'],
            ],
        ],
        'staging' => [
            'environment' => 'staging',
        'env_template' => __DIR__ . '/env-templates/staging.env',
            'env' => [
                'APP_ENV' => 'staging',
                'APP_URL' => 'https://staging.blackcat.local',
            ],
            'modules' => ['blackcat-database', 'blackcat-messaging', 'blackcat-crypto'],
            'telemetry' => [
                'channel' => 'file://' . dirname(__DIR__) . '/var/log/config-staging.ndjson',
            ],
            'integrations' => [
                'installer' => '../blackcat-installer/bin/installer',
                'database' => 'blackcat://db',
                'messaging' => '../blackcat-messaging/bin/messaging',
                'security' => '../blackcat-security/bin/security',
            ],
            'security' => [
                'required_env' => ['APP_URL'],
            ],
        ],
        'prod' => [
            'environment' => 'production',
        'env_template' => __DIR__ . '/env-templates/production.env',
            'env' => [
                'APP_ENV' => 'prod',
                'APP_URL' => 'https://app.blackcat.cloud',
            ],
            'modules' => ['blackcat-database', 'blackcat-crypto', 'blackcat-security'],
            'telemetry' => [
                'channel' => 'stdout',
            ],
            'integrations' => [
                'installer' => '../blackcat-installer/bin/installer',
                'governance' => '../blackcat-governance/bin/governance',
                'orchestrator' => '../blackcat-orchestrator/bin/orchestrator',
            ],
            'security' => [
                'required_env' => ['APP_URL'],
                'requires_tls' => true,
            ],
        ],
    ],
];
