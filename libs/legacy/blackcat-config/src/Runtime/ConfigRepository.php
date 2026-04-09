<?php

declare(strict_types=1);

namespace BlackCat\Config\Runtime;

use BlackCat\Config\Security\ConfigFilePolicy;
use BlackCat\Config\Security\SecurityException;
use BlackCat\Config\Security\SecureFile;

final class ConfigRepository
{
    /**
     * @param array<string,mixed> $data
     */
    private function __construct(
        private readonly array $data,
        private readonly ?string $sourcePath,
    )
    {
    }

    /**
     * @param array<string,mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self($data, null);
    }

    public static function fromJsonFile(string $path, ?ConfigFilePolicy $policy = null): self
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, "\0")) {
            throw new SecurityException('Config file path is invalid.');
        }
        if (self::isStreamWrapperPath($path)) {
            throw new SecurityException('Config file path must be a local filesystem path (stream wrappers are not allowed): ' . $path);
        }
        if (!self::isAbsolutePath($path)) {
            throw new SecurityException('Config file path must be absolute (relative paths are not allowed): ' . $path);
        }

        SecureFile::assertSecureReadableFile($path, $policy);
        self::assertNotInDocumentRoot($path);

        $raw = file_get_contents($path);
        if ($raw === false) {
            throw new \RuntimeException('Unable to read config file: ' . $path);
        }

        try {
            /** @var mixed $decoded */
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new \RuntimeException('Invalid JSON config file: ' . $path, 0, $e);
        }

        if (!is_array($decoded)) {
            throw new \RuntimeException('Config JSON must decode to an object/array: ' . $path);
        }

        /** @var array<string,mixed> $decoded */
        $repo = new self($decoded, $path);

        // Security-first: validate security-critical sections eagerly (when present).
        RuntimeConfigValidator::assertTrustKernelWeb3Config($repo);

        if ($repo->get('http') !== null) {
            RuntimeConfigValidator::assertHttpConfig($repo);
        }
        if ($repo->get('db') !== null) {
            RuntimeConfigValidator::assertDbConfig($repo);
        }
        if ($repo->get('crypto') !== null) {
            RuntimeConfigValidator::assertCryptoConfig($repo);
        }
        if ($repo->get('observability') !== null) {
            RuntimeConfigValidator::assertObservabilityConfig($repo);
        }

        return $repo;
    }

    public function sourcePath(): ?string
    {
        return $this->sourcePath;
    }

    /**
     * Dot-notation lookup (e.g., "app.name").
     */
    public function get(string $key, mixed $default = null): mixed
    {
        if ($key === '') {
            return $default;
        }

        $cur = $this->data;
        foreach (explode('.', $key) as $segment) {
            if ($segment === '') {
                return $default;
            }
            if (!is_array($cur) || !array_key_exists($segment, $cur)) {
                return $default;
            }
            $cur = $cur[$segment];
        }

        return $cur;
    }

    public function requireString(string $key): string
    {
        $val = $this->get($key);
        if (!is_string($val) || $val === '') {
            throw new \RuntimeException('Missing required config string: ' . $key);
        }
        return $val;
    }

    public function requireInt(string $key): int
    {
        $val = $this->get($key);
        if (is_int($val)) {
            return $val;
        }
        if (is_string($val)) {
            $trimmed = trim($val);
            if ($trimmed !== '' && ctype_digit($trimmed)) {
                return (int) $trimmed;
            }
        }

        throw new \RuntimeException('Missing required config integer: ' . $key);
    }

    /**
     * Resolve a potentially relative filesystem path value against the config source directory.
     *
     * Relative paths are resolved relative to the config JSON file location, not the process CWD.
     */
    public function resolvePath(string $path): string
    {
        $path = trim($path);
        if ($path === '') {
            throw new \RuntimeException('Config path is empty.');
        }
        if (str_contains($path, "\0")) {
            throw new \RuntimeException('Config path contains null byte.');
        }
        if (self::isStreamWrapperPath($path)) {
            throw new \RuntimeException('Config path must be a local filesystem path (stream wrappers are not allowed).');
        }
        if (self::containsTraversalSegment($path)) {
            throw new \RuntimeException('Config path must not contain traversal segments (..).');
        }

        if (self::isAbsolutePath($path)) {
            return $path;
        }

        if ($this->sourcePath === null) {
            throw new \RuntimeException('Relative paths require a config sourcePath (load via fromJsonFile).');
        }

        $baseDir = dirname($this->sourcePath);
        if ($baseDir === '' || $baseDir === '.') {
            throw new \RuntimeException('Unable to resolve relative path (invalid config sourcePath): ' . $this->sourcePath);
        }

        return rtrim($baseDir, "/\\") . DIRECTORY_SEPARATOR . $path;
    }

    private static function isAbsolutePath(string $path): bool
    {
        if ($path === '') {
            return false;
        }

        if ($path[0] === '/' || $path[0] === '\\') {
            return true;
        }

        return (bool) preg_match('~^[a-zA-Z]:[\\\\/]~', $path);
    }

    private static function isStreamWrapperPath(string $path): bool
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, "\0")) {
            return false;
        }

        return (bool) preg_match('~^[a-zA-Z][a-zA-Z0-9+.-]*://~', $path);
    }

    private static function containsTraversalSegment(string $path): bool
    {
        $path = str_replace('\\', '/', $path);
        foreach (explode('/', $path) as $seg) {
            if ($seg === '..') {
                return true;
            }
        }
        return false;
    }

    private static function assertNotInDocumentRoot(string $path): void
    {
        $docRoot = self::documentRoot();
        if ($docRoot === null) {
            return;
        }

        $docRootNorm = self::normalizeFsPath($docRoot);
        $pathNorm = self::normalizeFsPath($path);
        if ($docRootNorm === null || $pathNorm === null) {
            return;
        }

        if (self::isPathWithin($pathNorm, $docRootNorm)) {
            throw new SecurityException(sprintf(
                'Runtime config file must not be located inside the web document root (%s): %s',
                $docRootNorm,
                $pathNorm,
            ));
        }
    }

    private static function documentRoot(): ?string
    {
        $candidates = [
            $_SERVER['CONTEXT_DOCUMENT_ROOT'] ?? null,
            $_SERVER['DOCUMENT_ROOT'] ?? null,
        ];

        foreach ($candidates as $raw) {
            if (!is_string($raw)) {
                continue;
            }
            $raw = trim($raw);
            if ($raw === '' || str_contains($raw, "\0")) {
                continue;
            }
            return $raw;
        }

        return null;
    }

    private static function normalizeFsPath(string $path): ?string
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, "\0")) {
            return null;
        }

        $real = @realpath($path);
        if (is_string($real) && $real !== '') {
            $path = $real;
        }

        $path = str_replace('\\', '/', $path);
        $path = rtrim($path, '/');
        if ($path === '') {
            $path = '/';
        }

        if (DIRECTORY_SEPARATOR === '\\') {
            $path = strtolower($path);
        }

        return $path;
    }

    private static function isPathWithin(string $child, string $parent): bool
    {
        $parent = rtrim($parent, '/');
        if ($parent === '') {
            $parent = '/';
        }

        if ($parent === '/') {
            return str_starts_with($child, '/');
        }

        return $child === $parent || str_starts_with($child, $parent . '/');
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        return $this->data;
    }
}
