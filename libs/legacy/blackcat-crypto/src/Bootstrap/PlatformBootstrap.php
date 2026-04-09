<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Bootstrap;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\CryptoManager;
use Psr\Log\LoggerInterface;

/**
 * One-call bootstrap helper for application repositories.
 *
 * - Boots {@see CryptoManager} from runtime config (preferred) or explicit options.
 * - If present, initializes `blackcat-core` engines so they delegate to the CoreCryptoBridge.
 * - If present, wires optional `blackcat-database` ingress hooks (gateway factory).
 */
final class PlatformBootstrap
{
    /**
     * @param array{
     *   keys_dir?:string,
     *   manifest?:string,
     *   kms?:mixed,
     *   rotation?:mixed,
     *   aead?:mixed,
     *   wrap_queue?:mixed,
     *   logger?:mixed,
     *   strict?:bool,
     *   init_core?:bool,
     *   init_database?:bool,
     *   db_encryption_map?:string|null,
     *   db_gateway_factory?:mixed,
     * } $options
     */
    public static function boot(array $options = []): CryptoManager
    {
        $strict = (bool)($options['strict'] ?? true);
        $logger = $options['logger'] ?? null;
        if ($logger !== null && !$logger instanceof LoggerInterface) {
            throw new \InvalidArgumentException('PlatformBootstrap: logger must implement LoggerInterface');
        }

        $keysDir = $options['keys_dir'] ?? null;
        $manifest = $options['manifest'] ?? null;

        if (($keysDir === null || $manifest === null) && class_exists('\\BlackCat\\Config\\Runtime\\Config')) {
            try {
                /** @phpstan-ignore-next-line optional dependency */
                if (!\BlackCat\Config\Runtime\Config::isInitialized()) {
                    /** @phpstan-ignore-next-line optional dependency */
                    \BlackCat\Config\Runtime\Config::initFromFirstAvailableJsonFileIfNeeded();
                }

                /** @phpstan-ignore-next-line optional dependency */
                $repo = \BlackCat\Config\Runtime\Config::repo();

                if ($keysDir === null) {
                    $raw = $repo->get('crypto.keys_dir');
                    if (is_string($raw) && trim($raw) !== '') {
                        $keysDir = $repo->resolvePath($raw);
                    }
                }

                if ($manifest === null) {
                    $raw = $repo->get('crypto.manifest');
                    if (is_string($raw) && trim($raw) !== '') {
                        $manifest = $repo->resolvePath($raw);
                    }
                }
            } catch (\Throwable $e) {
                if ($strict) {
                    throw $e;
                }
            }
        }

        if (!is_string($keysDir) || trim($keysDir) === '') {
            throw new \RuntimeException('PlatformBootstrap: missing crypto keys_dir (use runtime config crypto.keys_dir or pass keys_dir option).');
        }
        $keysDir = trim($keysDir);

        if (!is_string($manifest)) {
            $manifest = null;
        }
        $manifest = $manifest !== null ? trim($manifest) : null;
        if ($manifest === '') {
            $manifest = null;
        }

        $cfg = CryptoConfig::fromArray([
            'keys_dir' => $keysDir,
            'manifest' => $manifest,
            'kms' => $options['kms'] ?? null,
            'rotation' => $options['rotation'] ?? null,
            'aead' => $options['aead'] ?? null,
            'wrap_queue' => $options['wrap_queue'] ?? null,
        ]);

        $crypto = CryptoManager::boot($cfg, $logger);

        if (($options['init_core'] ?? true) && class_exists('\\BlackCat\\Core\\Security\\Crypto')) {
            try {
                /** @phpstan-ignore-next-line optional dependency */
                \BlackCat\Core\Security\Crypto::initFromKeyManager($keysDir, $logger);
            } catch (\Throwable $e) {
                if ($strict) {
                    throw $e;
                }
            }
        }

        if (($options['init_core'] ?? true) && class_exists('\\BlackCat\\Core\\Security\\FileVault')) {
            try {
                /** @phpstan-ignore-next-line optional dependency */
                \BlackCat\Core\Security\FileVault::setKeysDir($keysDir);
            } catch (\Throwable $e) {
                if ($strict) {
                    throw $e;
                }
            }
        }

        if (($options['init_database'] ?? true) && class_exists('\\BlackCat\\Database\\Crypto\\IngressLocator')) {
            try {
                if (isset($options['db_gateway_factory']) && is_callable($options['db_gateway_factory'])) {
                    /** @phpstan-ignore-next-line optional dependency */
                    \BlackCat\Database\Crypto\IngressLocator::setGatewayFactory($options['db_gateway_factory']);
                }
            } catch (\Throwable $e) {
                if ($strict) {
                    throw $e;
                }
            }
        }

        return $crypto;
    }
}
