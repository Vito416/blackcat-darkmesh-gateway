<?php
declare(strict_types=1);

namespace BlackCat\Auth\Foundation;

use BlackCat\Auth\Identity\ArrayUserProvider;
use BlackCat\Auth\Identity\DatabaseUserProvider;
use BlackCat\Auth\Identity\PlainEmailHasher;
use BlackCat\Auth\Password\PasswordHasher;
use BlackCat\Auth\Password\RuntimeConfigPepperProvider;
use BlackCat\Core\Database;
use BlackCat\Database\Contracts\DatabaseIngressCriteriaAdapterInterface;
use BlackCat\Database\Crypto\IngressLocator;
use InvalidArgumentException;

final class UserStoreFactory
{
    /**
     * @param array<string,mixed> $config
     */
    public static function create(array $config): UserStoreInstance
    {
        $driver = $config['driver'] ?? 'array';
        if ($driver === 'database') {
            return self::createDatabaseStore($config);
        }

        $users = is_array($config['users'] ?? null) ? $config['users'] : [];
        return new UserStoreInstance(new ArrayUserProvider($users), null, null);
    }

    /**
     * @param array<string,mixed> $config
     */
    private static function createDatabaseStore(array $config): UserStoreInstance
    {
        $dsn = (string)($config['dsn'] ?? '');
        if ($dsn === '') {
            throw new InvalidArgumentException('user_store.dsn is required for database driver.');
        }

        if (str_starts_with($dsn, 'sqlite:')) {
            throw new InvalidArgumentException('user_store.database does not support sqlite; use mysql or postgres with blackcat-database users schema.');
        }

        $db = self::bootDatabase($config);
        self::requireIngressCriteriaAdapter();

        $pepperKey = (string)($config['pepper_config_key'] ?? 'auth.pepper');
        $pepperProvider = new RuntimeConfigPepperProvider($pepperKey);

        $hasher = new PasswordHasher($pepperProvider);
        $provider = new DatabaseUserProvider(
            $db,
            $hasher,
            new PlainEmailHasher(),
            [
                'table' => $config['table'] ?? 'users',
                'id_column' => $config['id_column'] ?? 'id',
                'email_hash_column' => $config['email_hash_column'] ?? 'email_hash',
                'password_column' => $config['password_column'] ?? 'password_hash',
                'pepper_version_column' => $config['pepper_version_column'] ?? 'password_key_version',
                'role_column' => $config['role_column'] ?? 'actor_role',
                'active_column' => $config['active_column'] ?? 'is_active',
                'locked_column' => $config['locked_column'] ?? 'is_locked',
                'deleted_at_column' => $config['deleted_at_column'] ?? 'deleted_at',
            ]
        );

        return new UserStoreInstance($provider, $db, $hasher);
    }

    /**
     * @param array<string,mixed> $config
     */
    private static function bootDatabase(array $config): Database
    {
        if (Database::isInitialized()) {
            return Database::getInstance();
        }

        $dsn = (string)($config['dsn'] ?? '');
        if ($dsn === '') {
            throw new InvalidArgumentException('user_store.dsn is required.');
        }

        $dbConfig = [
            'dsn' => $dsn,
            'user' => $config['user'] ?? $config['username'] ?? null,
            'pass' => $config['pass'] ?? $config['password'] ?? null,
            'options' => is_array($config['options'] ?? null)
                ? $config['options']
                : (is_array($config['attributes'] ?? null) ? $config['attributes'] : []),
            'init_commands' => is_array($config['init_commands'] ?? null) ? $config['init_commands'] : [],
            'appName' => (string)($config['appName'] ?? 'blackcat-auth'),
        ];

        foreach (['statementTimeoutMs', 'lockWaitTimeoutSec', 'replica', 'replicaStickMs', 'replicaMaxLagMs', 'replicaHealthCheckSec'] as $k) {
            if (array_key_exists($k, $config)) {
                $dbConfig[$k] = $config[$k];
            }
        }

        Database::init($dbConfig);
        return Database::getInstance();
    }

    private static function requireIngressCriteriaAdapter(): void
    {
        $adapter = IngressLocator::adapter();
        if (!$adapter instanceof DatabaseIngressCriteriaAdapterInterface) {
            throw new InvalidArgumentException(
                'Database user store requires crypto ingress for deterministic lookups (email_hash). '
                . 'Ensure blackcat-config runtime config is present and contains crypto.keys_dir + crypto.manifest.'
            );
        }
    }
}
