<?php
declare(strict_types=1);

namespace BlackCat\Auth\Security;

use BlackCat\Auth\Support\NoopIngressAdapter;
use BlackCat\Core\Database;
use BlackCat\Database\Contracts\DatabaseIngressCriteriaAdapterInterface;
use BlackCat\Database\Crypto\IngressLocator;
use BlackCat\Database\Packages\LoginAttempts\Criteria as LoginAttemptsCriteria;
use BlackCat\Database\Packages\LoginAttempts\Repository\LoginAttemptRepository;
use BlackCat\Database\Packages\RegisterEvents\Criteria as RegisterEventsCriteria;
use BlackCat\Database\Packages\RegisterEvents\Repository\RegisterEventRepository;
use BlackCat\Database\Support\BinaryCodec;

/**
 * LoginLimiter (auth-level brute-force protection).
 *
 * - Stores attempts into `login_attempts` and (optionally) `register_events`.
 * - Uses `blackcat-database-crypto` ingress *criteria* adapter to compute deterministic HMACs (no plaintext stored).
 * - Fail-open by design: limiter must never break auth flows.
 */
final class LoginLimiter
{
    private const DEFAULT_MAX_ATTEMPTS = 5;
    private const DEFAULT_WINDOW_SEC   = 300; // 5 minutes

    private function __construct() {}

    private static function noopIngress(): NoopIngressAdapter
    {
        static $noop = null;
        if (!$noop instanceof NoopIngressAdapter) {
            $noop = new NoopIngressAdapter();
        }
        return $noop;
    }

    private static function loginAttemptRepo(Database $db): LoginAttemptRepository
    {
        $repo = new LoginAttemptRepository($db);
        $repo->setIngressAdapter(self::noopIngress(), 'login_attempts');
        return $repo;
    }

    private static function registerEventRepo(Database $db): RegisterEventRepository
    {
        $repo = new RegisterEventRepository($db);
        $repo->setIngressAdapter(self::noopIngress(), 'register_events');
        return $repo;
    }

    /**
     * Prepare 32-byte binary or 64-char hex for storage.
     *
     * @return string|null raw 32-byte binary
     */
    private static function prepareBin32ForStorage(mixed $val): ?string
    {
        if ($val === null) {
            return null;
        }

        if (\is_resource($val)) {
            try {
                $read = @stream_get_contents($val);
                if (\is_string($read) && \strlen($read) === 32) {
                    return $read;
                }
            } catch (\Throwable) {
            }
            return null;
        }

        if (!\is_string($val)) {
            return null;
        }

        // Binary 32-byte – treat as hash only when it doesn't look like a normal printable string.
        if (\strlen($val) === 32) {
            try {
                $isUtf8 = \preg_match('//u', $val) === 1;
                if ($isUtf8 && \ctype_print($val)) {
                    return null;
                }
            } catch (\Throwable) {
            }
            return $val;
        }

        // 64-char hex
        if (\strlen($val) === 64 && \ctype_xdigit($val)) {
            $bin = @hex2bin($val);
            return $bin === false ? null : $bin;
        }

        return null;
    }

    private static function normalizeUsername(string $username): string
    {
        $normalized = \trim($username);
        if (\class_exists(\Normalizer::class, true)) {
            $normalized = \Normalizer::normalize($normalized, \Normalizer::FORM_C) ?: $normalized;
        }
        return \mb_strtolower($normalized, 'UTF-8');
    }

    private static function resolveClientIp(?string $ip = null): ?string
    {
        $ip = \is_string($ip) ? \trim($ip) : null;
        if ($ip !== null && $ip !== '') {
            return $ip;
        }
        $remote = $_SERVER['REMOTE_ADDR'] ?? null;
        $remote = \is_string($remote) ? \trim($remote) : null;
        return ($remote !== null && $remote !== '') ? $remote : null;
    }

    private static function criteriaAdapter(): ?DatabaseIngressCriteriaAdapterInterface
    {
        try {
            $adapter = IngressLocator::adapter();
            return $adapter instanceof DatabaseIngressCriteriaAdapterInterface ? $adapter : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Compute deterministic hash using ingress criteria adapter.
     *
     * @return string|null raw binary (decoded from hex/base64 when needed)
     */
    private static function hmacFor(string $table, string $column, string $value): ?string
    {
        $adapter = self::criteriaAdapter();
        if ($adapter === null) {
            return null;
        }

        try {
            $out = $adapter->criteria($table, [$column => $value]);
        } catch (\Throwable) {
            return null;
        }

        $raw = $out[$column] ?? null;
        $bin = BinaryCodec::toBinary($raw);
        return (\is_string($bin) && \strlen($bin) === 32) ? $bin : null;
    }

    /**
     * Zaregistruje login pokus (best-effort).
     *
     * @param string|null $ip Plain IP or null (REMOTE_ADDR fallback)
     * @param bool $success  true = successful login, false = failure
     * @param int|null $userId optional user id
     * @param string|resource|null $usernameHashOrUsername optional username hash (bin32/hex64) or plaintext username/email
     */
    public static function registerAttempt(?string $ip = null, bool $success = false, ?int $userId = null, mixed $usernameHashOrUsername = null): void
    {
        if (!Database::isInitialized()) {
            return;
        }

        $db = Database::getInstance();

        $clientIp = self::resolveClientIp($ip);
        if ($clientIp === null) {
            return;
        }

        $ipHash = self::hmacFor('login_attempts', 'ip_hash', $clientIp);
        if ($ipHash === null) {
            return;
        }

        $usernameHash = self::prepareBin32ForStorage($usernameHashOrUsername);
        if ($usernameHash === null && \is_string($usernameHashOrUsername) && \trim($usernameHashOrUsername) !== '') {
            $usernameHash = self::hmacFor(
                'login_attempts',
                'username_hash',
                self::normalizeUsername($usernameHashOrUsername)
            );
        }

        try {
            self::loginAttemptRepo($db)->insert([
                'ip_hash' => $ipHash,
                'success' => $success ? 1 : 0,
                'user_id' => $userId,
                'username_hash' => $usernameHash,
            ]);
        } catch (\Throwable) {
            // silent fail — limiter must never crash the application
        }
    }

    /**
     * Returns true when the IP has too many failed attempts within the window (count >= maxAttempts).
     */
    public static function isBlocked(?string $ip = null, int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS, int $windowSec = self::DEFAULT_WINDOW_SEC): bool
    {
        if (!Database::isInitialized()) {
            return false;
        }

        $db = Database::getInstance();

        $clientIp = self::resolveClientIp($ip);
        if ($clientIp === null) {
            return false;
        }

        $ipHash = self::hmacFor('login_attempts', 'ip_hash', $clientIp);
        if ($ipHash === null) {
            return false;
        }

        $cutoff = \gmdate('Y-m-d H:i:s', \time() - \max(0, $windowSec));

        try {
            $repo = new LoginAttemptRepository($db);
            $criteria = LoginAttemptsCriteria::fromDb($db)
                ->where('ip_hash', '=', $ipHash)
                ->where('attempted_at', '>=', $cutoff)
                ->where('success', '=', 0);
            [$where, $params] = $criteria->toSql(true);
            if ($where === '') {
                return false;
            }
            $cnt = $repo->count($where, $params);
            return $cnt >= \max(1, $maxAttempts);
        } catch (\Throwable) {
            // fail-open
            return false;
        }
    }

    /**
     * Returns the number of failed attempts in the window for the IP.
     */
    public static function getAttemptsCount(?string $ip = null, int $windowSec = self::DEFAULT_WINDOW_SEC): int
    {
        if (!Database::isInitialized()) {
            return 0;
        }

        $db = Database::getInstance();

        $clientIp = self::resolveClientIp($ip);
        if ($clientIp === null) {
            return 0;
        }

        $ipHash = self::hmacFor('login_attempts', 'ip_hash', $clientIp);
        if ($ipHash === null) {
            return 0;
        }

        $cutoff = \gmdate('Y-m-d H:i:s', \time() - \max(0, $windowSec));

        try {
            $repo = new LoginAttemptRepository($db);
            $criteria = LoginAttemptsCriteria::fromDb($db)
                ->where('ip_hash', '=', $ipHash)
                ->where('attempted_at', '>=', $cutoff)
                ->where('success', '=', 0);
            [$where, $params] = $criteria->toSql(true);
            if ($where === '') {
                return 0;
            }
            return $repo->count($where, $params);
        } catch (\Throwable) {
            return 0;
        }
    }

    /**
     * Returns how many attempts remain (>=0).
     */
    public static function getRemainingAttempts(?string $ip = null, int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS, int $windowSec = self::DEFAULT_WINDOW_SEC): int
    {
        $count = self::getAttemptsCount($ip, $windowSec);
        $remaining = \max(1, $maxAttempts) - $count;
        return $remaining > 0 ? $remaining : 0;
    }

    /**
     * Returns number of seconds until unlock (0 = not blocked).
     */
    public static function getSecondsUntilUnblock(?string $ip = null, int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS, int $windowSec = self::DEFAULT_WINDOW_SEC): int
    {
        if (!Database::isInitialized()) {
            return 0;
        }

        $db = Database::getInstance();

        $clientIp = self::resolveClientIp($ip);
        if ($clientIp === null) {
            return 0;
        }

        $ipHash = self::hmacFor('login_attempts', 'ip_hash', $clientIp);
        if ($ipHash === null) {
            return 0;
        }

        $maxAttempts = \max(1, $maxAttempts);
        $windowSec = \max(1, $windowSec);
        $cutoff = \gmdate('Y-m-d H:i:s', \time() - $windowSec);

        try {
            $repo = new LoginAttemptRepository($db);
            $criteria = LoginAttemptsCriteria::fromDb($db)
                ->where('ip_hash', '=', $ipHash)
                ->where('attempted_at', '>=', $cutoff)
                ->where('success', '=', 0)
                ->orderBy('attempted_at', 'DESC')
                ->setPerPage($maxAttempts)
                ->setPage(1);
            $page = $repo->paginate($criteria);
            $rows = $page['items'];
            if (\count($rows) < $maxAttempts) {
                return 0;
            }

            $oldest = $rows[\count($rows) - 1]['attempted_at'] ?? null;
            if (!\is_string($oldest) || \trim($oldest) === '') {
                return 0;
            }

            try {
                $oldestDt = new \DateTimeImmutable($oldest, new \DateTimeZone('UTC'));
                $oldestTs = $oldestDt->getTimestamp();
            } catch (\Throwable) {
                $oldestTs = \strtotime($oldest . ' UTC') ?: 0;
            }
            if ($oldestTs <= 0) {
                return 0;
            }

            $elapsed = \time() - $oldestTs;
            $remaining = $windowSec - $elapsed;
            return $remaining > 0 ? $remaining : 0;
        } catch (\Throwable) {
            return 0;
        }
    }

    /**
     * Registers a sign-up attempt into register_events (best-effort).
     *
     * @param array<string,mixed>|null $meta
     */
    public static function registerRegisterAttempt(
        bool $success = false,
        ?int $userId = null,
        ?string $userAgent = null,
        ?array $meta = null,
        ?string $error = null
    ): void {
        if (!Database::isInitialized()) {
            return;
        }

        $db = Database::getInstance();

        $clientIp = self::resolveClientIp(null);
        if ($clientIp === null) {
            return;
        }

        $adapter = self::criteriaAdapter();
        if ($adapter === null) {
            return;
        }

        $criteria = $adapter->criteria('register_events', ['ip_hash' => $clientIp]);
        $ipHash = BinaryCodec::toBinary($criteria['ip_hash'] ?? null);
        if (!\is_string($ipHash) || \strlen($ipHash) !== 32) {
            return;
        }

        $ipKeyVer = $criteria['ip_hash_key_version'] ?? null;
        $type = $success ? 'register_success' : 'register_failure';
        $ua = $userAgent ?? ($_SERVER['HTTP_USER_AGENT'] ?? null);

        $metaPayload = [];
        if (\is_array($meta)) {
            foreach ($meta as $k => $v) {
                if (!\is_string($k) || $k === '') {
                    continue;
                }
                if (\is_scalar($v) || $v === null || \is_array($v)) {
                    $metaPayload[$k] = $v;
                } else {
                    $metaPayload[$k] = (string)$v;
                }
            }
        }
        if ($ipKeyVer !== null && $ipKeyVer !== '') {
            $metaPayload['_ip_hash_key_version'] = (string)$ipKeyVer;
        }
        if ($error !== null && $error !== '') {
            $metaPayload['error'] = $error;
        }

        $metaJson = null;
        if ($metaPayload !== []) {
            $json = \json_encode($metaPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $metaJson = $json === false ? null : $json;
        }

        try {
            self::registerEventRepo($db)->insert([
                'user_id' => $userId,
                'type' => $type,
                'ip_hash' => $ipHash,
                'ip_hash_key_version' => \is_string($ipKeyVer) && $ipKeyVer !== '' ? $ipKeyVer : null,
                'user_agent' => \is_string($ua) && $ua !== '' ? $ua : null,
                'meta' => $metaJson,
            ]);
        } catch (\Throwable) {
        }
    }

    public static function isRegisterBlocked(?string $ip = null, int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS, int $windowSec = self::DEFAULT_WINDOW_SEC): bool
    {
        if (!Database::isInitialized()) {
            return false;
        }

        $db = Database::getInstance();
        $clientIp = self::resolveClientIp($ip);
        if ($clientIp === null) {
            return false;
        }

        $ipHash = self::hmacFor('register_events', 'ip_hash', $clientIp);
        if ($ipHash === null) {
            return false;
        }

        $cutoff = \gmdate('Y-m-d H:i:s', \time() - \max(0, $windowSec));

        try {
            $repo = new RegisterEventRepository($db);
            $criteria = RegisterEventsCriteria::fromDb($db)
                ->where('ip_hash', '=', $ipHash)
                ->where('occurred_at', '>=', $cutoff)
                ->where('type', '=', 'register_failure');
            [$where, $params] = $criteria->toSql(true);
            if ($where === '') {
                return false;
            }
            $cnt = $repo->count($where, $params);
            return $cnt >= \max(1, $maxAttempts);
        } catch (\Throwable) {
            return false;
        }
    }

    public static function getRegisterAttemptsCount(?string $ip = null, int $windowSec = self::DEFAULT_WINDOW_SEC): int
    {
        if (!Database::isInitialized()) {
            return 0;
        }

        $db = Database::getInstance();
        $clientIp = self::resolveClientIp($ip);
        if ($clientIp === null) {
            return 0;
        }

        $ipHash = self::hmacFor('register_events', 'ip_hash', $clientIp);
        if ($ipHash === null) {
            return 0;
        }

        $cutoff = \gmdate('Y-m-d H:i:s', \time() - \max(0, $windowSec));

        try {
            $repo = new RegisterEventRepository($db);
            $criteria = RegisterEventsCriteria::fromDb($db)
                ->where('ip_hash', '=', $ipHash)
                ->where('occurred_at', '>=', $cutoff)
                ->where('type', '=', 'register_failure');
            [$where, $params] = $criteria->toSql(true);
            if ($where === '') {
                return 0;
            }
            return $repo->count($where, $params);
        } catch (\Throwable) {
            return 0;
        }
    }

    public static function getRegisterRemainingAttempts(?string $ip = null, int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS, int $windowSec = self::DEFAULT_WINDOW_SEC): int
    {
        $count = self::getRegisterAttemptsCount($ip, $windowSec);
        $remaining = \max(1, $maxAttempts) - $count;
        return $remaining > 0 ? $remaining : 0;
    }

    public static function getRegisterSecondsUntilUnblock(?string $ip = null, int $maxAttempts = self::DEFAULT_MAX_ATTEMPTS, int $windowSec = self::DEFAULT_WINDOW_SEC): int
    {
        if (!Database::isInitialized()) {
            return 0;
        }

        $db = Database::getInstance();

        $clientIp = self::resolveClientIp($ip);
        if ($clientIp === null) {
            return 0;
        }

        $ipHash = self::hmacFor('register_events', 'ip_hash', $clientIp);
        if ($ipHash === null) {
            return 0;
        }

        $maxAttempts = \max(1, $maxAttempts);
        $windowSec = \max(1, $windowSec);
        $cutoff = \gmdate('Y-m-d H:i:s', \time() - $windowSec);

        try {
            $repo = new RegisterEventRepository($db);
            $criteria = RegisterEventsCriteria::fromDb($db)
                ->where('ip_hash', '=', $ipHash)
                ->where('occurred_at', '>=', $cutoff)
                ->where('type', '=', 'register_failure')
                ->orderBy('occurred_at', 'DESC')
                ->setPerPage($maxAttempts)
                ->setPage(1);
            $page = $repo->paginate($criteria);
            $rows = $page['items'];
            if (\count($rows) < $maxAttempts) {
                return 0;
            }

            $oldest = $rows[\count($rows) - 1]['occurred_at'] ?? null;
            if (!\is_string($oldest) || \trim($oldest) === '') {
                return 0;
            }

            try {
                $oldestDt = new \DateTimeImmutable($oldest, new \DateTimeZone('UTC'));
                $oldestTs = $oldestDt->getTimestamp();
            } catch (\Throwable) {
                $oldestTs = \strtotime($oldest . ' UTC') ?: 0;
            }
            if ($oldestTs <= 0) {
                return 0;
            }

            $elapsed = \time() - $oldestTs;
            $remaining = $windowSec - $elapsed;
            return $remaining > 0 ? $remaining : 0;
        } catch (\Throwable) {
            return 0;
        }
    }

    /**
     * Cleanup for stale attempts — recommended to run from CRON.
     */
    public static function cleanup(int $olderThanSec = 86400): void
    {
        if (!Database::isInitialized()) {
            return;
        }

        $db = Database::getInstance();
        $cutoff = \gmdate('Y-m-d H:i:s', \time() - \max(0, $olderThanSec));
        $repo = new LoginAttemptRepository($db);
        $criteria = LoginAttemptsCriteria::fromDb($db)
            ->where('attempted_at', '<', $cutoff)
            ->orderBy('attempted_at', 'ASC')
            ->setPerPage(1000)
            ->setPage(1);

        while (true) {
            try {
                $page = $repo->paginate($criteria);
            } catch (\Throwable) {
                break;
            }
            $items = $page['items'];
            if ($items === []) {
                break;
            }
            $deleted = 0;
            foreach ($items as $row) {
                $id = (int)($row['id'] ?? 0);
                if ($id <= 0) {
                    continue;
                }
                try {
                    $deleted += $repo->deleteById($id);
                } catch (\Throwable) {
                }
            }
            if ($deleted <= 0) {
                break;
            }
        }
    }
}
