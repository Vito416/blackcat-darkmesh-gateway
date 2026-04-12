<?php

declare(strict_types=1);

namespace BlackCat\Config\Runtime;

use BlackCat\Config\Security\ConfigFilePolicy;

/**
 * Global config facade (opt-in).
 *
 * Intended usage:
 *   Config::initFromJsonFile('/etc/blackcat/config.runtime.json');
 *   $appName = Config::requireString('app.name');
 */
final class Config
{
    private static ?ConfigRepository $repo = null;

    public static function isInitialized(): bool
    {
        return self::$repo !== null;
    }

    public static function init(ConfigRepository $repo): void
    {
        if (self::$repo !== null) {
            throw new \RuntimeException('Config already initialized.');
        }
        self::$repo = $repo;
    }

    /**
     * Idempotent initialization helper for libraries.
     *
     * If Config is already initialized, this is a no-op.
     */
    public static function initIfNeeded(ConfigRepository $repo): void
    {
        if (self::$repo !== null) {
            return;
        }
        self::$repo = $repo;
    }

    public static function initFromJsonFile(string $path, ?ConfigFilePolicy $policy = null): void
    {
        self::init(ConfigRepository::fromJsonFile($path, $policy));
    }

    /**
     * Idempotent variant of {@see initFromJsonFile()}.
     */
    public static function initFromJsonFileIfNeeded(string $path, ?ConfigFilePolicy $policy = null): void
    {
        if (self::$repo !== null) {
            return;
        }
        self::$repo = ConfigRepository::fromJsonFile($path, $policy);
    }

    /**
     * Initialize from the first available secure JSON config file (strict-by-default).
     *
     * @param list<string>|null $paths Candidate absolute paths to try.
     */
    public static function initFromFirstAvailableJsonFile(?array $paths = null, ?ConfigFilePolicy $policy = null): void
    {
        self::init(ConfigBootstrap::loadFirstAvailableJsonFile($paths, $policy));
    }

    /**
     * Idempotent variant of {@see initFromFirstAvailableJsonFile()}.
     *
     * @param list<string>|null $paths Candidate absolute paths to try.
     */
    public static function initFromFirstAvailableJsonFileIfNeeded(?array $paths = null, ?ConfigFilePolicy $policy = null): void
    {
        if (self::$repo !== null) {
            return;
        }
        self::$repo = ConfigBootstrap::loadFirstAvailableJsonFile($paths, $policy);
    }

    /**
     * Try to initialize from the first available secure JSON config file.
     *
     * @param list<string>|null $paths Candidate absolute paths to try.
     */
    public static function tryInitFromFirstAvailableJsonFile(?array $paths = null, ?ConfigFilePolicy $policy = null): bool
    {
        if (self::$repo !== null) {
            return true;
        }
        $repo = ConfigBootstrap::tryLoadFirstAvailableJsonFile($paths, $policy);
        if ($repo === null) {
            return false;
        }
        self::$repo = $repo;
        return true;
    }

    public static function repo(): ConfigRepository
    {
        if (self::$repo === null) {
            throw new \RuntimeException('Config is not initialized.');
        }
        return self::$repo;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::repo()->get($key, $default);
    }

    public static function requireString(string $key): string
    {
        return self::repo()->requireString($key);
    }
}
