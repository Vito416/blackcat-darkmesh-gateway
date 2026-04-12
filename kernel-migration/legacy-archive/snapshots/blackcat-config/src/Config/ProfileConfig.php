<?php

declare(strict_types=1);

namespace BlackCat\Config\Config;

use BlackCat\Config\Profile\ConfigProfile;
use InvalidArgumentException;

final class ProfileConfig
{
    /**
     * @param ConfigProfile[] $profiles
     * @param array<string,mixed> $defaults
     */
    private function __construct(
        private readonly array $profiles,
        private readonly array $defaults,
        private readonly string $sourcePath,
        private readonly string $basePath
    ) {
    }

    public static function fromFile(string $path): self
    {
        if (!is_file($path)) {
            throw new InvalidArgumentException("Config profiles not found: {$path}");
        }

        $payload = require $path;
        if (!is_array($payload)) {
            throw new InvalidArgumentException('Config profiles file must return array');
        }

        $basePath = dirname($path);
        $defaults = self::normalizeDefaults($payload['defaults'] ?? []);
        $profilesPayload = $payload['profiles'] ?? $payload;

        $profiles = [];
        foreach ($profilesPayload as $key => $profileRow) {
            if (!is_array($profileRow)) {
                continue;
            }
            if (!isset($profileRow['name']) && is_string($key)) {
                $profileRow['name'] = $key;
            }
            $profileRow = self::mergeDefaults($defaults, $profileRow);
            $profiles[] = ConfigProfile::fromArray($profileRow, $basePath);
        }

        if ($profiles === []) {
            throw new InvalidArgumentException('No profiles defined in config file.');
        }

        return new self($profiles, $defaults, $path, $basePath);
    }

    /**
     * @return ConfigProfile[]
     */
    public function profiles(): array
    {
        return $this->profiles;
    }

    public function find(string $name): ?ConfigProfile
    {
        foreach ($this->profiles as $profile) {
            if ($profile->name() === $name) {
                return $profile;
            }
        }

        return null;
    }

    public function require(string $name): ConfigProfile
    {
        $profile = $this->find($name);
        if ($profile === null) {
            throw new InvalidArgumentException("Profile {$name} not found");
        }

        return $profile;
    }

    /**
     * @return array<string,mixed>
     */
    public function defaults(): array
    {
        return $this->defaults;
    }

    public function sourcePath(): string
    {
        return $this->sourcePath;
    }

    public function basePath(): string
    {
        return $this->basePath;
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        return [
            'source' => $this->sourcePath,
            'defaults' => $this->defaults,
            'profiles' => array_map(static fn (ConfigProfile $profile): array => $profile->toArray(), $this->profiles),
        ];
    }

    /**
     * @param array<string,mixed> $defaults
     *
     * @return array<string,mixed>
     */
    private static function normalizeDefaults(array $defaults): array
    {
        $defaults['env'] = self::stringifyMap($defaults['env'] ?? []);
        $defaults['modules'] = self::stringifyList($defaults['modules'] ?? []);
        $defaults['telemetry'] = is_array($defaults['telemetry'] ?? null) ? $defaults['telemetry'] : [];
        $defaults['integrations'] = self::stringifyMap($defaults['integrations'] ?? []);
        $defaults['security'] = is_array($defaults['security'] ?? null) ? $defaults['security'] : [];

        return $defaults;
    }

    /**
     * @param array<string,mixed> $defaults
     * @param array<string,mixed> $profile
     *
     * @return array<string,mixed>
     */
    private static function mergeDefaults(array $defaults, array $profile): array
    {
        $merged = $profile;

        $merged['env'] = array_merge($defaults['env'] ?? [], self::stringifyMap($profile['env'] ?? []));

        $modules = array_merge($defaults['modules'] ?? [], self::stringifyList($profile['modules'] ?? []));
        $merged['modules'] = array_values(array_unique($modules));

        $merged['telemetry'] = array_merge($defaults['telemetry'] ?? [], is_array($profile['telemetry'] ?? null) ? $profile['telemetry'] : []);

        $merged['integrations'] = array_merge($defaults['integrations'] ?? [], self::stringifyMap($profile['integrations'] ?? []));

        $merged['security'] = self::mergeSecurity($defaults['security'] ?? [], is_array($profile['security'] ?? null) ? $profile['security'] : []);

        return $merged;
    }

    /**
     * @param array<int|string,mixed> $input
     *
     * @return array<int,string>
     */
    private static function stringifyList(array $input): array
    {
        $list = [];
        foreach ($input as $value) {
            $value = (string) $value;
            if ($value !== '') {
                $list[] = $value;
            }
        }

        return $list;
    }

    /**
     * @param array<string|int,mixed> $input
     *
     * @return array<string,string>
     */
    private static function stringifyMap(array $input): array
    {
        $map = [];
        foreach ($input as $key => $value) {
            $map[(string) $key] = (string) $value;
        }

        return $map;
    }

    /**
     * @param array<string,mixed> $defaults
     * @param array<string,mixed> $overrides
     *
     * @return array<string,mixed>
     */
    private static function mergeSecurity(array $defaults, array $overrides): array
    {
        $security = $defaults;

        foreach ($overrides as $key => $value) {
            if (in_array($key, ['required_env', 'secrets'], true)) {
                $security[$key] = array_values(array_unique(array_merge(
                    self::stringifyList($defaults[$key] ?? []),
                    self::stringifyList((array) $value)
                )));
                continue;
            }
            $security[$key] = $value;
        }

        return $security;
    }
}
