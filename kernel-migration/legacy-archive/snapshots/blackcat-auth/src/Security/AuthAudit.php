<?php
declare(strict_types=1);

namespace BlackCat\Auth\Security;

use BlackCat\Auth\Support\NoopIngressAdapter;
use BlackCat\Core\Database;
use BlackCat\Database\Contracts\DatabaseIngressCriteriaAdapterInterface;
use BlackCat\Database\Crypto\IngressLocator;
use BlackCat\Database\Packages\AuthEvents\Repository\AuthEventRepository;
use BlackCat\Database\Support\BinaryCodec;

/**
 * AuthAudit (DB-backed, best-effort).
 *
 * Writes into `auth_events` (blackcat-database package) without leaking plaintext email/IP:
 * - ip_hash is deterministic HMAC (binary) computed via ingress criteria adapter
 * - meta.email is stored as email_hash hex (so meta_email index still works, but without plaintext)
 *
 * Fail-open by design: audit must never break auth flows.
 */
final class AuthAudit
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

    private static function repo(Database $db): AuthEventRepository
    {
        $repo = new AuthEventRepository($db);
        $repo->setIngressAdapter(self::noopIngress(), 'auth_events');
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

    private static function normalizeEmail(string $email): string
    {
        $normalized = \trim($email);
        if (\class_exists(\Normalizer::class, true)) {
            $normalized = \Normalizer::normalize($normalized, \Normalizer::FORM_C) ?: $normalized;
        }
        return \mb_strtolower($normalized, 'UTF-8');
    }

    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>|null
     */
    private static function criteria(string $table, array $payload): ?array
    {
        $adapter = self::criteriaAdapter();
        if ($adapter === null) {
            return null;
        }
        try {
            /** @var array<string,mixed> */
            return $adapter->criteria($table, $payload);
        } catch (\Throwable) {
            return null;
        }
    }

    private static function bin32ToHex(?string $bin): ?string
    {
        if (!\is_string($bin) || \strlen($bin) !== 32) {
            return null;
        }
        return \strtoupper(\bin2hex($bin));
    }

    /**
     * @param array<string,mixed> $meta
     */
    public static function record(string $type, ?int $userId = null, ?string $ip = null, ?string $userAgent = null, ?string $email = null, array $meta = []): void
    {
        if (!Database::isInitialized()) {
            return;
        }

        $db = Database::getInstance();

        $clientIp = self::resolveClientIp($ip);
        $criteria = $clientIp !== null ? self::criteria('auth_events', ['ip_hash' => $clientIp]) : null;
        $ipHash = BinaryCodec::toBinary($criteria['ip_hash'] ?? null);
        $ipHash = (\is_string($ipHash) && \strlen($ipHash) === 32) ? $ipHash : null;
        $ipKeyVer = $criteria['ip_hash_key_version'] ?? null;

        if (\is_string($email) && \trim($email) !== '') {
            $emailNorm = self::normalizeEmail($email);
            $emailCrit = self::criteria('users', ['email_hash' => $emailNorm]);
            $emailBin = BinaryCodec::toBinary($emailCrit['email_hash'] ?? null);
            $emailHex = self::bin32ToHex((\is_string($emailBin) && \strlen($emailBin) === 32) ? $emailBin : null);
            if ($emailHex !== null) {
                // Keep meta_email generated column meaningful, but avoid plaintext.
                $meta['email'] = $emailHex;
                if (isset($emailCrit['email_hash_key_version']) && \is_string($emailCrit['email_hash_key_version'])) {
                    $meta['email_hash_key_version'] = $emailCrit['email_hash_key_version'];
                }
            }
        }

        if ($ipKeyVer !== null && $ipKeyVer !== '') {
            $meta['_ip_hash_key_version'] = (string)$ipKeyVer;
        }

        $metaJson = null;
        if ($meta !== []) {
            $encoded = \json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $metaJson = $encoded === false ? null : $encoded;
        }

        try {
            self::repo($db)->insert([
                'user_id' => $userId,
                'type' => $type,
                'ip_hash' => $ipHash,
                'ip_hash_key_version' => \is_string($ipKeyVer) && $ipKeyVer !== '' ? $ipKeyVer : null,
                'user_agent' => \is_string($userAgent) && \trim($userAgent) !== '' ? \trim($userAgent) : null,
                'meta' => $metaJson,
            ]);
        } catch (\Throwable) {
        }
    }
}
