<?php
declare(strict_types=1);

namespace BlackCat\Auth\Security;

use BlackCat\Auth\Support\NoopIngressAdapter;
use BlackCat\Core\Database;
use BlackCat\Database\Contracts\DatabaseIngressCriteriaAdapterInterface;
use BlackCat\Database\Crypto\IngressLocator;
use BlackCat\Database\Packages\RateLimitCounters\Repository\RateLimitCounterRepository;
use BlackCat\Database\Support\BinaryCodec;

/**
 * RateLimitCountersLimiter
 *
 * Shared limiter implementation backed by `rate_limit_counters` (blackcat-database package).
 *
 * - Uses ingress *criteria* adapter to compute deterministic hashes (no plaintext email/IP stored).
 * - Fail-open by design: limiter must never break auth flows.
 */
final class RateLimitCountersLimiter
{
    private function __construct() {}

    private static function noopIngress(): NoopIngressAdapter
    {
        static $noop = null;
        if (!$noop instanceof NoopIngressAdapter) {
            $noop = new NoopIngressAdapter();
        }
        return $noop;
    }

    private static function repo(Database $db): RateLimitCounterRepository
    {
        $repo = new RateLimitCounterRepository($db);
        $repo->setIngressAdapter(self::noopIngress(), 'rate_limit_counters');
        return $repo;
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

    private static function normalizeEmail(string $email): string
    {
        $normalized = \trim($email);
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

    /**
     * Compute deterministic hash using ingress criteria adapter.
     *
     * @return string|null raw binary (32 bytes)
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

    private static function bin32ToHex(?string $bin): ?string
    {
        if (!\is_string($bin) || \strlen($bin) !== 32) {
            return null;
        }
        return \strtoupper(\bin2hex($bin));
    }

    /**
     * @return array{count:int,retry_after:int}|null null = limiter disabled/fail-open
     */
    private static function hitCounter(string $subjectType, string $subjectId, string $name, int $windowSizeSec): ?array
    {
        if (!Database::isInitialized()) {
            return null;
        }

        $db = Database::getInstance();
        $repo = self::repo($db);

        $windowSizeSec = \max(1, $windowSizeSec);
        $now = \time();
        $windowStartEpoch = \intdiv($now, $windowSizeSec) * $windowSizeSec;
        $windowEndEpoch = $windowStartEpoch + $windowSizeSec;
        $windowStartSql = \gmdate('Y-m-d H:i:s', $windowStartEpoch);

        try {
            /** @var array{count:int,retry_after:int} */
            return $db->transaction(static function (Database $db) use ($repo, $subjectType, $subjectId, $name, $windowStartSql, $windowSizeSec, $windowEndEpoch): array {
                try {
                    // Attempt INSERT in a savepoint; on conflicts Postgres must rollback to savepoint.
                    $db->transaction(static function (Database $_db) use ($repo, $subjectType, $subjectId, $name, $windowStartSql, $windowSizeSec): void {
                        $repo->insert([
                            'subject_type' => $subjectType,
                            'subject_id' => $subjectId,
                            'name' => $name,
                            'window_start' => $windowStartSql,
                            'window_size_sec' => $windowSizeSec,
                            'count' => 1,
                        ]);
                    });

                    return [
                        'count' => 1,
                        'retry_after' => \max(0, $windowEndEpoch - \time()),
                    ];
                } catch (\Throwable) {
                    // Row exists; lock + increment.
                }

                $row = $repo->getBySubjectTypeAndSubjectIdAndNameAndWindowStartAndWindowSizeSec(
                    $subjectType,
                    $subjectId,
                    $name,
                    $windowStartSql,
                    $windowSizeSec,
                    false
                );
                if (!\is_array($row) || !isset($row['id'])) {
                    return [
                        'count' => 0,
                        'retry_after' => \max(0, $windowEndEpoch - \time()),
                    ];
                }

                $id = (int)$row['id'];
                if ($id <= 0) {
                    return [
                        'count' => 0,
                        'retry_after' => \max(0, $windowEndEpoch - \time()),
                    ];
                }

                $locked = $repo->lockById($id, 'wait', 'update') ?? $row;
                $current = isset($locked['count']) ? (int)$locked['count'] : (int)($row['count'] ?? 0);
                $next = $current + 1;

                try {
                    $repo->updateById($id, ['count' => $next]);
                } catch (\Throwable) {
                    // keep best-effort result
                }

                return [
                    'count' => $next,
                    'retry_after' => \max(0, $windowEndEpoch - \time()),
                ];
            });
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Throws TooManyAttemptsException when throttled (429) – otherwise returns silently.
     *
     * @param string|null $ip plain client IP (REMOTE_ADDR fallback)
     */
    public static function assertAllowed(
        ?string $ip,
        string $email,
        int $maxPerIp,
        int $maxPerEmail,
        int $windowSec,
        string $counterName,
    ): void {
        $email = \trim($email);
        if ($email === '') {
            return;
        }

        $counterName = \trim($counterName);
        if ($counterName === '') {
            return;
        }

        if ($windowSec <= 0 || ($maxPerIp <= 0 && $maxPerEmail <= 0)) {
            return;
        }

        $clientIp = self::resolveClientIp($ip);
        $normalizedEmail = self::normalizeEmail($email);

        $retryAfter = 0;

        // Per-IP counter
        if ($maxPerIp > 0 && $clientIp !== null && $clientIp !== '') {
            $ipHash = self::bin32ToHex(self::hmacFor('login_attempts', 'ip_hash', $clientIp));
            if ($ipHash !== null) {
                $hit = self::hitCounter('ip_hash', $ipHash, $counterName, $windowSec);
                if (\is_array($hit)) {
                    if ($hit['count'] > $maxPerIp) {
                        $retryAfter = \max($retryAfter, $hit['retry_after']);
                    }
                }
            }
        }

        // Per-email counter (hashed via users.email_hash)
        if ($maxPerEmail > 0 && $normalizedEmail !== '') {
            $emailHash = self::bin32ToHex(self::hmacFor('users', 'email_hash', $normalizedEmail));
            if ($emailHash !== null) {
                $hit = self::hitCounter('email_hash', $emailHash, $counterName, $windowSec);
                if (\is_array($hit)) {
                    if ($hit['count'] > $maxPerEmail) {
                        $retryAfter = \max($retryAfter, $hit['retry_after']);
                    }
                }
            }
        }

        if ($retryAfter > 0) {
            throw new TooManyAttemptsException($retryAfter);
        }
    }
}
