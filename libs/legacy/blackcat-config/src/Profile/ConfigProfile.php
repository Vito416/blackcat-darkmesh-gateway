<?php

declare(strict_types=1);

namespace BlackCat\Config\Profile;

use InvalidArgumentException;
use RuntimeException;

final class ConfigProfile
{
    /**
     * @param array<string,string> $env
     * @param array<int,string> $modules
     * @param array<string,mixed> $telemetry
     * @param array<string,string> $integrations
     * @param array<string,mixed> $security
     */
    private function __construct(
        private readonly string $name,
        private readonly string $environment,
        private readonly array $env,
        private readonly array $modules,
        private readonly array $telemetry,
        private readonly array $integrations,
        private readonly array $security,
        private readonly ?string $envTemplate
    ) {
    }

    /**
     * @param array<string,mixed> $payload
     */
    public static function fromArray(array $payload, string $baseDir): self
    {
        if (!isset($payload['name'])) {
            $payload['name'] = $payload['environment'] ?? null;
        }

        foreach (['name', 'environment'] as $field) {
            if (!isset($payload[$field])) {
                throw new InvalidArgumentException("Profile missing {$field}");
            }
        }

        $env = [];
        foreach (($payload['env'] ?? []) as $key => $value) {
            $env[(string) $key] = (string) $value;
        }

        $modules = [];
        foreach (($payload['modules'] ?? []) as $module) {
            $module = (string) $module;
            if ($module !== '') {
                $modules[] = $module;
            }
        }

        $telemetry = self::normalizeTelemetry($payload['telemetry'] ?? []);
        $integrations = self::normalizeIntegrations($payload['integrations'] ?? [], $baseDir);
        $security = self::normalizeSecurity($payload['security'] ?? []);

        return new self(
            (string) $payload['name'],
            (string) $payload['environment'],
            $env,
            $modules,
            $telemetry,
            $integrations,
            $security,
            self::normalizeTemplatePath($payload['env_template'] ?? null, $baseDir)
        );
    }

    public function name(): string
    {
        return $this->name;
    }

    public function environment(): string
    {
        return $this->environment;
    }

    /**
     * @return array<string,string>
     */
    public function env(): array
    {
        return $this->env;
    }

    /**
     * @return array<int,string>
     */
    public function modules(): array
    {
        return $this->modules;
    }

    public function telemetryChannel(string $default = 'stdout'): string
    {
        $channel = (string) ($this->telemetry['channel'] ?? $default);
        return $channel === '' ? $default : $channel;
    }

    /**
     * @return array<string,mixed>
     */
    public function telemetry(): array
    {
        return $this->telemetry;
    }

    /**
     * @return array<string,string>
     */
    public function integrations(): array
    {
        return $this->integrations;
    }

    public function integration(string $key): ?string
    {
        $value = $this->integrations[$key] ?? null;
        return $value === null || $value === '' ? null : $value;
    }

    /**
     * @return array<string,mixed>
     */
    public function securityRules(): array
    {
        return $this->security;
    }

    public function envTemplatePath(): ?string
    {
        return $this->envTemplate;
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        return [
            'name' => $this->name,
            'environment' => $this->environment,
            'env' => $this->env,
            'modules' => $this->modules,
            'telemetry' => $this->telemetry,
            'integrations' => $this->integrations,
            'security' => $this->security,
            'env_template' => $this->envTemplate,
        ];
    }

    private static function normalizeTemplatePath(mixed $path, string $baseDir): ?string
    {
        if (!is_string($path) || $path === '') {
            return null;
        }
        if ($path[0] === '/' || preg_match('#^[A-Za-z]:#', $path) === 1) {
            return $path;
        }

        $fullPath = rtrim($baseDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . ltrim($path, DIRECTORY_SEPARATOR);
        $prefix = rtrim($baseDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if (strncmp($fullPath, $prefix, strlen($prefix)) !== 0) {
            throw new RuntimeException("Env template path {$path} resolves outside of config directory");
        }

        return $fullPath;
    }

    /**
     * @param array<string,mixed> $telemetry
     *
     * @return array<string,mixed>
     */
    private static function normalizeTelemetry(array $telemetry): array
    {
        $channel = (string) ($telemetry['channel'] ?? 'stdout');

        return [
            'channel' => $channel === '' ? 'stdout' : $channel,
        ];
    }

    /**
     * @param array<string,mixed> $integrations
     *
     * @return array<string,string>
     */
    private static function normalizeIntegrations(array $integrations, string $baseDir): array
    {
        $map = [];
        foreach ($integrations as $key => $value) {
            $key = (string) $key;
            $value = (string) $value;
            if ($key === '' || $value === '') {
                continue;
            }
            $map[$key] = self::resolveIntegrationPath($value, $baseDir);
        }

        return $map;
    }

    private static function resolveIntegrationPath(string $path, string $baseDir): string
    {
        if (preg_match('#^[A-Za-z]+://#', $path) === 1) {
            return $path;
        }
        if ($path[0] === '/' || preg_match('#^[A-Za-z]:#', $path) === 1) {
            return $path;
        }

        return rtrim($baseDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . ltrim($path, DIRECTORY_SEPARATOR);
    }

    /**
     * @param array<string,mixed> $security
     *
     * @return array<string,mixed>
     */
    private static function normalizeSecurity(array $security): array
    {
        $normalized = [];
        foreach ($security as $key => $value) {
            if (in_array($key, ['required_env', 'secrets'], true)) {
                $normalized[$key] = self::stringifyList((array) $value);
                continue;
            }
            $normalized[$key] = $value;
        }

        return $normalized;
    }

    /**
     * @param array<int|string,mixed> $values
     *
     * @return array<int,string>
     */
    private static function stringifyList(array $values): array
    {
        $list = [];
        foreach ($values as $value) {
            $value = (string) $value;
            if ($value !== '') {
                $list[] = $value;
            }
        }

        return $list;
    }
}
