<?php

declare(strict_types=1);

namespace BlackCat\Config\Runtime;

use BlackCat\Config\Security\ConfigFilePolicy;
use BlackCat\Config\Security\SecureFile;

/**
 * Best-available runtime config installer.
 *
 * Goal:
 * - pick the safest writable location available on the current system
 * - create the runtime config file with strict permissions when possible
 * - remain usable on platforms where POSIX permissions are not available (Windows)
 */
final class RuntimeConfigInstaller
{
    /**
     * @return list<string>
     */
    public static function defaultWritePaths(): array
    {
        return DIRECTORY_SEPARATOR === '\\'
            ? self::defaultWritePathsWindows()
            : self::defaultWritePathsPosix();
    }

    /**
     * Recommend the best writable path (without writing).
     *
     * @param list<string>|null $candidates
     * @return array{
     *   path:?string,
     *   reason:string,
     *   rejected:array<string,string>,
     *   candidates:list<string>,
     *   analysis:list<array{path:string,status:string,score:int,reason:string}>
     * }
     */
    public static function recommendWritePath(?array $candidates = null): array
    {
        $candidates = $candidates !== null ? array_values($candidates) : self::defaultWritePaths();

        $normalized = [];
        foreach ($candidates as $path) {
            $path = trim((string) $path);
            if ($path === '') {
                continue;
            }
            $normalized[] = $path;
        }
        $normalized = array_values(array_unique($normalized));

        $rejected = [];
        /** @var list<array{path:string,status:string,score:int,reason:string}> $analysis */
        $analysis = [];

        /** @var array{path:string,status:string,score:int,reason:string}|null $best */
        $best = null;

        foreach ($normalized as $path) {
            $eval = self::evaluateWriteCandidate($path);
            $analysis[] = [
                'path' => $eval['path'],
                'status' => $eval['status'],
                'score' => $eval['score'],
                'reason' => $eval['reason'],
            ];

            if ($eval['status'] === 'reject') {
                $rejected[$path] = $eval['reason'];
                continue;
            }

            if ($best === null || $eval['score'] > $best['score']) {
                $best = $eval;
            }
        }

        if ($best !== null) {
            return [
                'path' => $best['path'],
                'reason' => $best['reason'],
                'rejected' => $rejected,
                'candidates' => $normalized,
                'analysis' => $analysis,
            ];
        }

        return [
            'path' => null,
            'reason' => 'No writable candidate path found.',
            'rejected' => $rejected,
            'candidates' => $normalized,
            'analysis' => $analysis,
        ];
    }

    /**
     * Create (or reuse) runtime config file in the best available location.
     *
     * - If `$path` is provided, only that path is used.
     * - Otherwise, candidates are tried in priority order.
     *
     * @param array<string,mixed> $payload JSON payload written into the config file (default: {}).
     * @param list<string>|null $candidates
     * @return array{path:string,created:bool,rejected:array<string,string>}
     */
    public static function init(array $payload = [], ?string $path = null, bool $force = false, ?array $candidates = null): array
    {
        $list = [];
        if ($path !== null) {
            $path = trim($path);
            if ($path !== '') {
                $list = [$path];
            }
        }
        if ($list === []) {
            $list = $candidates !== null ? array_values($candidates) : self::defaultWritePaths();
        }

        $rejected = [];

        foreach ($list as $candidate) {
            $candidate = trim((string) $candidate);
            if ($candidate === '') {
                continue;
            }

            $existedBefore = file_exists($candidate);
            $created = false;

            try {
                $created = self::ensureRuntimeConfigFile($candidate, $payload, $force);
                // Validate post-write to ensure this location is actually usable by strict readers.
                SecureFile::assertSecureReadableFile($candidate, ConfigFilePolicy::strict());

                return [
                    'path' => $candidate,
                    'created' => $created,
                    'rejected' => $rejected,
                ];
            } catch (\Throwable $e) {
                if ($created && !$existedBefore) {
                    @unlink($candidate);
                }
                $rejected[$candidate] = $e->getMessage();
                continue;
            }
        }

        $lines = [];
        foreach ($rejected as $p => $reason) {
            $lines[] = sprintf('- %s: %s', $p, $reason);
        }

        throw new \RuntimeException(sprintf(
            "Unable to initialize runtime config file.\nRejected candidates:\n%s",
            $lines !== [] ? implode("\n", $lines) : '(none)',
        ));
    }

    /**
     * Convenience wrapper: initialize runtime config in the best available location.
     *
     * Equivalent to calling {@see self::init()} without providing an explicit path.
     *
     * @param array<string,mixed> $payload
     * @param list<string>|null $candidates
     * @return array{path:string,created:bool,rejected:array<string,string>}
     */
    public static function initRecommended(array $payload = [], bool $force = false, ?array $candidates = null): array
    {
        return self::init($payload, null, $force, $candidates);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private static function ensureRuntimeConfigFile(string $path, array $payload, bool $force): bool
    {
        $path = trim($path);
        if ($path === '') {
            throw new \InvalidArgumentException('Runtime config path is empty.');
        }
        if (str_contains($path, "\0")) {
            throw new \InvalidArgumentException('Runtime config path contains null byte.');
        }
        if (self::isStreamWrapperPath($path)) {
            throw new \InvalidArgumentException('Runtime config path must be a local filesystem path (stream wrappers are not allowed): ' . $path);
        }
        if (self::containsTraversalSegment($path)) {
            throw new \InvalidArgumentException('Runtime config path must not contain traversal segments (..): ' . $path);
        }
        if (!self::isAbsolutePath($path)) {
            throw new \InvalidArgumentException('Runtime config path must be absolute (relative paths are not allowed): ' . $path);
        }

        self::assertNotInDocumentRoot($path);

        $dir = dirname($path);
        if ($dir === '' || $dir === '.' || $dir === DIRECTORY_SEPARATOR) {
            throw new \RuntimeException('Runtime config path must not be root: ' . $path);
        }

        self::assertNoSymlinkParents($dir);

        if (!is_dir($dir)) {
            if (!@mkdir($dir, 0750, true) && !is_dir($dir)) {
                throw new \RuntimeException('Unable to create config directory: ' . $dir);
            }
            if (DIRECTORY_SEPARATOR !== '\\') {
                @chmod($dir, 0750);
            }
        }

        if (is_link($dir)) {
            throw new \RuntimeException('Config directory must not be a symlink: ' . $dir);
        }

        if (is_file($path)) {
            if (is_link($path)) {
                throw new \RuntimeException('Runtime config file must not be a symlink: ' . $path);
            }

            // If the existing file is valid and we are not forcing a rewrite, keep it.
            try {
                SecureFile::assertSecureReadableFile($path, ConfigFilePolicy::strict());
                return false;
            } catch (\Throwable $e) {
                if (!$force) {
                    throw new \RuntimeException(
                        'Existing runtime config file is not secure/valid: ' . $e->getMessage() . ' (use --force to overwrite)'
                    );
                }
            }
        } elseif (file_exists($path)) {
            throw new \RuntimeException('Runtime config path exists but is not a file: ' . $path);
        }

        $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) {
            throw new \RuntimeException('Unable to encode runtime config JSON.');
        }

        $tmp = $dir . DIRECTORY_SEPARATOR . '.blackcat-config.' . bin2hex(random_bytes(8)) . '.tmp';
        $fp = @fopen($tmp, 'xb');
        if ($fp === false) {
            throw new \RuntimeException('Unable to create temp file in: ' . $dir);
        }

        try {
            $bytes = fwrite($fp, $json . "\n");
            if ($bytes === false) {
                throw new \RuntimeException('Unable to write runtime config temp file.');
            }
        } finally {
            fclose($fp);
        }

        if (DIRECTORY_SEPARATOR !== '\\') {
            @chmod($tmp, 0600);
        }

        // Validate the temp file before moving it into place. If strict validation fails, avoid leaving secrets
        // behind on disk in a location that the installer will later reject.
        try {
            SecureFile::assertSecureReadableFile($tmp, ConfigFilePolicy::strict());
        } catch (\Throwable $e) {
            @unlink($tmp);
            throw new \RuntimeException('Runtime config temp file is not secure/valid: ' . $e->getMessage());
        }

        if (!@rename($tmp, $path)) {
            @unlink($tmp);
            throw new \RuntimeException('Unable to move runtime config into place: ' . $path);
        }

        if (DIRECTORY_SEPARATOR !== '\\') {
            @chmod($path, 0600);
        }

        return true;
    }

    private static function nearestExistingDir(string $dir): ?string
    {
        $dir = trim($dir);
        if ($dir === '' || $dir === '.') {
            return null;
        }

        while ($dir !== '' && $dir !== '.' && $dir !== DIRECTORY_SEPARATOR) {
            if (is_dir($dir)) {
                return $dir;
            }
            $parent = dirname($dir);
            if ($parent === $dir) {
                break;
            }
            $dir = $parent;
        }

        return is_dir(DIRECTORY_SEPARATOR) ? DIRECTORY_SEPARATOR : null;
    }

    /**
     * Evaluate a candidate path for writing runtime config.
     *
     * Important: this must stay aligned with {@see self::ensureRuntimeConfigFile()}
     * (symlink parents, POSIX permission requirements, etc.).
     *
     * @return array{path:string,status:'ok'|'warn'|'reject',score:int,reason:string}
     */
    private static function evaluateWriteCandidate(string $path): array
    {
        $path = trim($path);
        if ($path === '') {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'Path is empty.'];
        }
        if (str_contains($path, "\0")) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'Path contains null byte.'];
        }
        if (self::isStreamWrapperPath($path)) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'Path must be a local filesystem path (stream wrappers are not allowed).'];
        }
        if (self::containsTraversalSegment($path)) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'Path must not contain traversal segments (..).'];
        }
        if (!self::isAbsolutePath($path)) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'Path must be absolute (relative paths are not allowed).'];
        }

        try {
            self::assertNotInDocumentRoot($path);
        } catch (\Throwable $e) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => $e->getMessage()];
        }

        $warnings = [];
        $score = self::baseSecurityScore($path);

        if (self::isLikelyWindowsMountPath($path)) {
            $warnings[] = 'Path appears to be on a Windows-mounted filesystem (WSL /mnt/<drive>); avoid for secrets.';
            $score -= 40;
        }

        if (self::isLikelyTemporaryPath($path)) {
            $warnings[] = 'Path appears to be in a temporary directory; avoid for persistent runtime config.';
            $score -= 20;
        }

        if (is_file($path)) {
            try {
                SecureFile::assertSecureReadableFile($path, ConfigFilePolicy::strict());
            } catch (\Throwable $e) {
                return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => $e->getMessage()];
            }

            $score += 20; // existing secure file is a strong signal

            $reason = 'Existing runtime config file is present and passes strict validation.';
            if ($warnings !== []) {
                $reason .= ' Warnings: ' . implode(' ', $warnings);
                return ['path' => $path, 'status' => 'warn', 'score' => $score, 'reason' => $reason];
            }

            return ['path' => $path, 'status' => 'ok', 'score' => $score, 'reason' => $reason];
        }

        if (file_exists($path)) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'Path exists but is not a file: ' . $path];
        }

        $dir = dirname($path);
        if ($dir === '' || $dir === '.' || $dir === DIRECTORY_SEPARATOR) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'Runtime config path must not be root: ' . $path];
        }

        try {
            self::assertNoSymlinkParents($dir);
        } catch (\Throwable $e) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => $e->getMessage()];
        }

        $parent = self::nearestExistingDir($dir);
        if ($parent === null) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'No existing parent directory found.'];
        }
        if (!is_writable($parent)) {
            return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => 'Parent directory is not writable: ' . $parent];
        }

        if (DIRECTORY_SEPARATOR !== '\\') {
            try {
                $dirWarn = self::assertDirIsSafeToWriteConfig($parent);
                if ($dirWarn !== null) {
                    $warnings[] = $dirWarn;
                    $score -= 30;
                }
            } catch (\Throwable $e) {
                return ['path' => $path, 'status' => 'reject', 'score' => 0, 'reason' => $e->getMessage()];
            }
        }

        $reason = 'Parent directory is writable: ' . $parent . '.';
        if ($warnings !== []) {
            $reason .= ' Warnings: ' . implode(' ', $warnings);
            return ['path' => $path, 'status' => 'warn', 'score' => $score, 'reason' => $reason];
        }

        return ['path' => $path, 'status' => 'ok', 'score' => $score, 'reason' => $reason];
    }

    /**
     * Base score for path class (system > user > workspace).
     */
    private static function baseSecurityScore(string $path): int
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            $p = strtolower($path);
            if (str_starts_with($p, 'c:\\programdata\\blackcat\\')) {
                return 100;
            }
            if (str_contains($p, '\\appdata\\roaming\\blackcat\\')) {
                return 85;
            }
            if (str_contains($p, '\\appdata\\local\\blackcat\\')) {
                return 80;
            }
            if (str_contains($p, '\\.blackcat\\')) {
                return 60;
            }
            return 50;
        }

        if (str_starts_with($path, '/etc/blackcat/')) {
            return 100;
        }

        $home = self::homeDir();
        if ($home !== null) {
            if (str_starts_with($path, $home . '/.config/blackcat/')) {
                return 85;
            }
            if (str_starts_with($path, $home . '/.blackcat/')) {
                return 80;
            }
        }

        if (str_contains($path, '/.config/blackcat/')) {
            return 75;
        }
        if (str_contains($path, '/.blackcat/')) {
            return 60;
        }

        return 50;
    }

    public static function isLikelyWindowsMountPath(string $path): bool
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            return false;
        }

        return (bool) preg_match('~^/mnt/[a-zA-Z]/~', $path);
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

    private static function isAbsolutePath(string $path): bool
    {
        $path = trim($path);
        if ($path === '') {
            return false;
        }

        if ($path[0] === '/' || $path[0] === '\\') {
            return true;
        }

        return (bool) preg_match('~^[a-zA-Z]:[\\\\/]~', $path);
    }

    private static function isLikelyTemporaryPath(string $path): bool
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            $p = strtolower($path);
            return str_contains($p, '\\temp\\') || str_contains($p, '\\tmp\\');
        }

        return str_starts_with($path, '/tmp/')
            || str_starts_with($path, '/var/tmp/')
            || str_starts_with($path, '/run/')
            || str_starts_with($path, '/dev/shm/');
    }

    /**
     * Validate the directory used for writing runtime config.
     *
     * @return ?string Warning message (sticky/tmp-like dir) when the directory is usable but not ideal.
     */
    private static function assertDirIsSafeToWriteConfig(string $dir): ?string
    {
        if (is_link($dir)) {
            throw new \RuntimeException('Config directory must not be a symlink: ' . $dir);
        }

        $perms = fileperms($dir);
        if (!is_int($perms)) {
            throw new \RuntimeException('Unable to read directory permissions: ' . $dir);
        }

        $mode = $perms & 0777;
        $sticky = ($perms & 0o1000) !== 0;

        $groupWritable = ($mode & 0o020) !== 0;
        $worldWritable = ($mode & 0o002) !== 0;

        if (($groupWritable || $worldWritable) && !$sticky) {
            throw new \RuntimeException(sprintf('Config directory must not be group/world-writable (%o): %s', $mode, $dir));
        }

        if (($groupWritable || $worldWritable) && $sticky) {
            return sprintf('Parent dir is sticky and writable by others (%o): %s', $mode, $dir);
        }

        return null;
    }

    private static function assertNoSymlinkParents(string $dir): void
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            return;
        }

        $dir = rtrim($dir, '/');
        if ($dir === '') {
            return;
        }

        $prefix = str_starts_with($dir, '/') ? '/' : '';
        $parts = array_values(array_filter(explode('/', ltrim($dir, '/')), static fn (string $p): bool => $p !== ''));

        $cur = $prefix;
        foreach ($parts as $part) {
            $cur = $cur === '/' ? $cur . $part : $cur . '/' . $part;
            if (is_link($cur)) {
                throw new \RuntimeException('Parent directory must not be a symlink: ' . $cur);
            }
        }
    }

    /**
     * @return list<string>
     */
    private static function defaultWritePathsPosix(): array
    {
        $paths = [
            '/etc/blackcat/config.runtime.json',
            '/etc/blackcat/config.json',
        ];

        $docRootParent = self::docRootParentDir();
        if ($docRootParent !== null) {
            // Shared hosting convenience: prefer placing runtime config next to the docroot (outside it),
            // so the bootstrap can discover it deterministically without env.
            $paths[] = $docRootParent . '/config.runtime.json';
            $paths[] = $docRootParent . '/.blackcat/config.runtime.json';
            $paths[] = $docRootParent . '/.config/blackcat/config.runtime.json';
        }

        $home = self::homeDir();
        if ($home !== null) {
            $paths[] = $home . '/.config/blackcat/config.runtime.json';
            $paths[] = $home . '/.blackcat/config.runtime.json';
        }

        return $paths;
    }

    /**
     * @return list<string>
     */
    private static function defaultWritePathsWindows(): array
    {
        $paths = [
            'C:\\ProgramData\\BlackCat\\config.runtime.json',
        ];

        $appData = self::serverString('APPDATA');
        if ($appData !== null) {
            $paths[] = rtrim($appData, '\\/') . '\\BlackCat\\config.runtime.json';
        }

        $localAppData = self::serverString('LOCALAPPDATA');
        if ($localAppData !== null) {
            $paths[] = rtrim($localAppData, '\\/') . '\\BlackCat\\config.runtime.json';
        }

        $profile = self::serverString('USERPROFILE');
        if ($profile !== null) {
            $paths[] = rtrim($profile, '\\/') . '\\.blackcat\\config.runtime.json';
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
            throw new \RuntimeException(sprintf(
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
