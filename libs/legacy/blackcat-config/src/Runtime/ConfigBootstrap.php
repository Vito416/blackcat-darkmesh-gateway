<?php

declare(strict_types=1);

namespace BlackCat\Config\Runtime;

use BlackCat\Config\Security\ConfigFilePolicy;

final class ConfigBootstrap
{
    /**
     * @return list<string>
     */
    public static function defaultJsonPaths(): array
    {
        $paths = [];

        if (DIRECTORY_SEPARATOR === '\\') {
            $paths = array_merge($paths, self::defaultJsonPathsWindows());
        } else {
            $paths = array_merge($paths, self::defaultJsonPathsPosix());
        }

        // Ensure stable order and no empty entries.
        $out = [];
        foreach ($paths as $path) {
            $path = trim((string) $path);
            if ($path === '') {
                continue;
            }
            $out[] = $path;
        }

        return array_values(array_unique($out));
    }

    /**
     * @param list<string>|null $paths Candidate absolute paths to try.
     * @return array{repo:?ConfigRepository,selected:?string,rejected:array<string,string>,paths:list<string>}
     */
    public static function scanFirstAvailableJsonFile(?array $paths = null, ?ConfigFilePolicy $policy = null): array
    {
        /** @var list<string> $paths */
        $paths = $paths !== null ? array_values($paths) : self::defaultJsonPaths();

        $normalized = [];
        foreach ($paths as $p) {
            $p = trim((string) $p);
            if ($p === '') {
                continue;
            }
            $normalized[] = $p;
        }

        $rejected = [];

        foreach ($normalized as $path) {
            if (!is_file($path)) {
                continue;
            }

            try {
                $repo = ConfigRepository::fromJsonFile($path, $policy);
                return [
                    'repo' => $repo,
                    'selected' => $path,
                    'rejected' => $rejected,
                    'paths' => $normalized,
                ];
            } catch (\Throwable $e) {
                $rejected[$path] = $e->getMessage();
                continue;
            }
        }

        return [
            'repo' => null,
            'selected' => null,
            'rejected' => $rejected,
            'paths' => $normalized,
        ];
    }

    /**
     * @param list<string>|null $paths Candidate absolute paths to try.
     */
    public static function tryLoadFirstAvailableJsonFile(?array $paths = null, ?ConfigFilePolicy $policy = null): ?ConfigRepository
    {
        $scan = self::scanFirstAvailableJsonFile($paths, $policy);
        return $scan['repo'];
    }

    /**
     * @param list<string>|null $paths Candidate absolute paths to try.
     */
    public static function loadFirstAvailableJsonFile(?array $paths = null, ?ConfigFilePolicy $policy = null): ConfigRepository
    {
        $scan = self::scanFirstAvailableJsonFile($paths, $policy);
        if ($scan['repo'] !== null) {
            return $scan['repo'];
        }

        $tried = $scan['paths'];
        $rejected = $scan['rejected'];

        if ($rejected !== []) {
            $lines = [];
            foreach ($rejected as $path => $reason) {
                $lines[] = sprintf('- %s: %s', $path, $reason);
            }

            throw new \RuntimeException(sprintf(
                "No usable runtime config file found.\nRejected files:\n%s\n\nTried: %s",
                implode("\n", $lines),
                implode(', ', array_map(static fn (string $p): string => '"' . $p . '"', $tried)),
            ));
        }

        throw new \RuntimeException(sprintf(
            'No runtime config file found (tried: %s).',
            implode(', ', array_map(static fn (string $p): string => '"' . $p . '"', $tried)),
        ));
    }

    /**
     * @return list<string>
     */
    private static function defaultJsonPathsPosix(): array
    {
        $paths = [
            // System-wide install (recommended).
            '/etc/blackcat/config.runtime.json',
            '/etc/blackcat/config.json',
            '/etc/blackcat/blackcat.json',

            // Containers / orchestrators.
            '/run/secrets/blackcat-config.json',
            '/run/secrets/blackcat.json',
        ];

        $docRootParent = self::docRootParentDir();
        if ($docRootParent !== null) {
            // Shared hosting convenience: allow placing config next to the web root (outside docroot).
            // Example layout:
            //   /home/user/app/public (docroot)
            //   /home/user/app/config.runtime.json
            //   /home/user/app/.blackcat/config.runtime.json
            $paths = array_merge($paths, [
                $docRootParent . '/config.runtime.json',
                $docRootParent . '/config.json',
                $docRootParent . '/.blackcat/config.runtime.json',
                $docRootParent . '/.blackcat/config.json',
                $docRootParent . '/.config/blackcat/config.runtime.json',
                $docRootParent . '/.config/blackcat/config.json',
            ]);
        }

        $home = self::homeDir();
        if ($home !== null) {
            $paths = array_merge($paths, [
                $home . '/.config/blackcat/config.runtime.json',
                $home . '/.config/blackcat/config.json',
                $home . '/.blackcat/config.runtime.json',
                $home . '/.blackcat/config.json',
            ]);
        }

        return $paths;
    }

    /**
     * @return list<string>
     */
    private static function defaultJsonPathsWindows(): array
    {
        $paths = [
            'C:\\ProgramData\\BlackCat\\config.runtime.json',
            'C:\\ProgramData\\BlackCat\\config.json',
        ];

        $appData = self::serverString('APPDATA');
        if ($appData !== null) {
            $paths[] = rtrim($appData, '\\/') . '\\BlackCat\\config.runtime.json';
            $paths[] = rtrim($appData, '\\/') . '\\BlackCat\\config.json';
        }

        $localAppData = self::serverString('LOCALAPPDATA');
        if ($localAppData !== null) {
            $paths[] = rtrim($localAppData, '\\/') . '\\BlackCat\\config.runtime.json';
            $paths[] = rtrim($localAppData, '\\/') . '\\BlackCat\\config.json';
        }

        return $paths;
    }

    private static function homeDir(): ?string
    {
        $home = self::serverString('HOME');
        if ($home !== null) {
            return rtrim($home, "\\/");
        }

        if (DIRECTORY_SEPARATOR !== '\\' && function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
            /** @var array{dir?:mixed}|false $info */
            $info = posix_getpwuid(posix_geteuid());
            $dir = is_array($info) ? ($info['dir'] ?? null) : null;
            if (is_string($dir) && $dir !== '') {
                return rtrim($dir, "\\/");
            }
        }

        $profile = self::serverString('USERPROFILE');
        if ($profile !== null) {
            return rtrim($profile, "\\/");
        }

        return null;
    }

    private static function serverString(string $key): ?string
    {
        $val = $_SERVER[$key] ?? null;
        if (!is_string($val)) {
            return null;
        }
        $val = trim($val);
        return $val !== '' ? $val : null;
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

    private static function docRootParentDir(): ?string
    {
        $docRoot = self::documentRoot();
        if ($docRoot === null) {
            return null;
        }

        $docRoot = rtrim(trim($docRoot), "/\\");
        if ($docRoot === '' || str_contains($docRoot, "\0")) {
            return null;
        }

        $real = @realpath($docRoot);
        if (is_string($real) && $real !== '') {
            $docRoot = $real;
        }

        $parent = dirname($docRoot);
        if ($parent === '' || $parent === '.' || $parent === DIRECTORY_SEPARATOR) {
            return null;
        }
        if (str_contains($parent, "\0")) {
            return null;
        }

        return rtrim($parent, "/\\");
    }
}
