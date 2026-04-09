<?php
declare(strict_types=1);

namespace BlackCat\Auth\Password;

use BlackCat\Config\Runtime\Config as RuntimeConfig;

/**
 * Pepper provider backed by `blackcat-config` runtime config (recommended).
 *
 * Expected key:
 * - `auth.pepper` (base64 string; 32 bytes)
 */
final class RuntimeConfigPepperProvider implements PepperProviderInterface
{
    public function __construct(private readonly string $configKey = 'auth.pepper') {}

    public function current(): Pepper
    {
        return $this->load($this->configKey, 'config');
    }

    public function all(): array
    {
        return [$this->current()];
    }

    public function byVersion(string $version): ?Pepper
    {
        return $version === 'config' ? $this->current() : null;
    }

    private function load(string $key, string $version): Pepper
    {
        if (!RuntimeConfig::isInitialized()) {
            RuntimeConfig::tryInitFromFirstAvailableJsonFile();
        }

        if (!RuntimeConfig::isInitialized()) {
            throw new \RuntimeException('Runtime config is not initialized (required for pepper).');
        }

        $raw = RuntimeConfig::get($key);
        if (!is_string($raw) || trim($raw) === '') {
            throw new \RuntimeException(sprintf('Pepper runtime config key %s is not set.', $key));
        }

        $bytes = base64_decode(trim($raw), true);
        if ($bytes === false || strlen($bytes) !== 32) {
            throw new \RuntimeException('Invalid pepper base64 in runtime config key ' . $key);
        }

        return new Pepper($bytes, $version);
    }
}

