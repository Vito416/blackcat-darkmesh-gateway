<?php

declare(strict_types=1);

namespace BlackCat\Config\Security;

final class SecureFile
{
    public static function assertSecureReadableFile(string $path, ?ConfigFilePolicy $policy = null): void
    {
        $policy ??= ConfigFilePolicy::strict();

        $path = trim($path);
        if ($path === '') {
            throw new SecurityException('Config file path is empty.');
        }
        if (str_contains($path, "\0")) {
            throw new SecurityException('Config file path contains null byte.');
        }
        if (self::isStreamWrapperPath($path)) {
            throw new SecurityException('Config file path must be a local filesystem path (stream wrappers are not allowed): ' . $path);
        }
        if (self::containsTraversalSegment($path)) {
            throw new SecurityException('Config file path must not contain traversal segments (..): ' . $path);
        }

        if (!file_exists($path)) {
            throw new SecurityException('Config file not found: ' . $path);
        }
        if (!$policy->allowSymlinks && is_link($path)) {
            throw new SecurityException('Config file must not be a symlink: ' . $path);
        }
        if (!is_file($path)) {
            throw new SecurityException('Config path is not a file: ' . $path);
        }
        if (!is_readable($path)) {
            throw new SecurityException('Config file is not readable: ' . $path);
        }

        $size = filesize($path);
        if (!is_int($size)) {
            throw new SecurityException('Unable to read config file size: ' . $path);
        }
        if ($size > $policy->maxBytes) {
            throw new SecurityException(sprintf(
                'Config file too large (%d B > %d B): %s',
                $size,
                $policy->maxBytes,
                $path
            ));
        }

        if (!$policy->allowSymlinks) {
            self::assertNoSymlinkParents(dirname($path));
        }

        self::assertSecurePermissions($path, $policy);
    }

    private static function assertSecurePermissions(string $path, ConfigFilePolicy $policy): void
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            return;
        }

        $perms = fileperms($path);
        if (!is_int($perms)) {
            throw new SecurityException('Unable to read config file permissions: ' . $path);
        }
        $mode = $perms & 0777;

        if ($policy->enforceOwner) {
            self::assertOwnedByRootOrCurrentUser($path, 'Config file');
        }

        if (!$policy->allowWorldWritable && (($mode & 0o002) !== 0)) {
            throw new SecurityException(sprintf('Config file must not be world-writable (%o): %s', $mode, $path));
        }
        if (!$policy->allowGroupWritable && (($mode & 0o020) !== 0)) {
            throw new SecurityException(sprintf('Config file must not be group-writable (%o): %s', $mode, $path));
        }
        if (!$policy->allowWorldReadable && (($mode & 0o004) !== 0)) {
            throw new SecurityException(sprintf('Config file must not be world-readable (%o): %s', $mode, $path));
        }

        $dir = dirname($path);
        if ($dir === '' || $dir === '.' || $dir === DIRECTORY_SEPARATOR) {
            return;
        }

        if ($policy->checkParentDirs) {
            self::assertParentDirsNotWritable($dir);
            return;
        }

        self::assertDirNotWritable($dir);
    }

    private static function assertOwnedByRootOrCurrentUser(string $path, string $label): void
    {
        if (!\function_exists('posix_geteuid') && !\function_exists(__NAMESPACE__ . '\\posix_geteuid')) {
            return;
        }

        $owner = fileowner($path);
        if (!is_int($owner)) {
            throw new SecurityException('Unable to read owner for: ' . $path);
        }

        $euid = posix_geteuid();
        if (!is_int($euid)) {
            return;
        }
        if ($euid < 0) {
            return;
        }

        if ($owner !== 0 && $owner !== $euid) {
            throw new SecurityException(sprintf(
                '%s must be owned by root or uid %d (got uid %d): %s',
                $label,
                $euid,
                $owner,
                $path
            ));
        }
    }

    private static function assertParentDirsNotWritable(string $startDir): void
    {
        $dir = $startDir;
        while ($dir !== '' && $dir !== '.' && $dir !== DIRECTORY_SEPARATOR) {
            // When open_basedir is set, PHP cannot access paths outside the allowlist.
            // In that case, checking writability of those parents is not meaningful for tamper-resistance.
            if (!self::isPathAllowedByOpenBasedir($dir)) {
                break;
            }
            self::assertDirNotWritable($dir);
            $parent = dirname($dir);
            if ($parent === $dir) {
                break;
            }
            $dir = $parent;
        }
    }

    private static function isPathAllowedByOpenBasedir(string $path): bool
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            return true;
        }

        $raw = ini_get('open_basedir');
        if (!is_string($raw) || trim($raw) === '') {
            return true;
        }

        $path = trim($path);
        if ($path === '' || str_contains($path, "\0")) {
            return false;
        }

        $path = rtrim($path, DIRECTORY_SEPARATOR);
        if ($path === '') {
            return false;
        }

        $parts = explode(PATH_SEPARATOR, $raw);
        foreach ($parts as $p) {
            $p = trim((string) $p);
            if ($p === '' || str_contains($p, "\0")) {
                continue;
            }
            $p = rtrim($p, DIRECTORY_SEPARATOR);
            if ($p === '') {
                continue;
            }
            if ($p === DIRECTORY_SEPARATOR) {
                return true;
            }
            if ($path === $p) {
                return true;
            }
            if (str_starts_with($path, $p . DIRECTORY_SEPARATOR)) {
                return true;
            }
        }

        return false;
    }

    private static function assertDirNotWritable(string $dir): void
    {
        $perms = fileperms($dir);
        if (!is_int($perms)) {
            throw new SecurityException('Unable to read directory permissions: ' . $dir);
        }

        $mode = $perms & 0777;
        $sticky = ($perms & 0o1000) !== 0;
        if (($mode & 0o002) !== 0 && !$sticky) {
            throw new SecurityException(sprintf('Config directory must not be world-writable (%o): %s', $mode, $dir));
        }
        if (($mode & 0o020) !== 0 && !$sticky) {
            throw new SecurityException(sprintf('Config directory must not be group-writable (%o): %s', $mode, $dir));
        }
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

    private static function assertNoSymlinkParents(string $dir): void
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            return;
        }

        $dir = rtrim(trim($dir), '/');
        if ($dir === '' || $dir === '.' || $dir === DIRECTORY_SEPARATOR) {
            return;
        }
        if (self::containsTraversalSegment($dir)) {
            throw new SecurityException('Config directory path must not contain traversal segments (..): ' . $dir);
        }

        $prefix = str_starts_with($dir, '/') ? '/' : '';
        $parts = array_values(array_filter(explode('/', ltrim($dir, '/')), static fn (string $p): bool => $p !== ''));

        $cur = $prefix;
        foreach ($parts as $part) {
            $cur = $cur === '/' ? $cur . $part : $cur . '/' . $part;
            // When open_basedir is set, PHP cannot access paths outside the allowlist.
            // In that case, checking symlink status of those parents is not meaningful.
            if (!self::isPathAllowedByOpenBasedir($cur)) {
                break;
            }
            if (is_link($cur)) {
                throw new SecurityException('Config directory must not contain symlink path components: ' . $cur);
            }
        }
    }
}
