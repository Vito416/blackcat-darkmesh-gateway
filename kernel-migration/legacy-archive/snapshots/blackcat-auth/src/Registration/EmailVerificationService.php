<?php
declare(strict_types=1);

namespace BlackCat\Auth\Registration;

use BlackCat\Core\Database;
use BlackCat\Database\Contracts\DatabaseIngressCriteriaAdapterInterface;
use BlackCat\Database\Crypto\IngressLocator;
use BlackCat\Database\Packages\EmailVerifications\Repository\EmailVerificationRepositoryInterface;
use BlackCat\Database\Packages\Users\Repository\UserRepositoryInterface;
use BlackCat\Database\Packages\VerifyEvents\Repository\VerifyEventRepositoryInterface;
use BlackCat\Database\Support\BinaryCodec;

final class EmailVerificationService
{
    public function __construct(
        private readonly Database $db,
        private readonly EmailVerificationRepositoryInterface $emailVerifications,
        private readonly UserRepositoryInterface $users,
        private readonly ?VerifyEventRepositoryInterface $verifyEvents = null,
        private readonly int $ttlSec = 86400,
    ) {}

    public function ttlSec(): int
    {
        return $this->ttlSec;
    }

    public function issueForUserId(int $userId, ?string $keyVersion = null): EmailVerificationToken
    {
        if ($userId <= 0) {
            throw new EmailVerificationException('invalid_user');
        }

        $token = EmailVerificationToken::issue();
        $validatorHash = $token->validatorHashBinary();
        if (!is_string($validatorHash) || strlen($validatorHash) !== 32) {
            throw new EmailVerificationException('invalid_token');
        }

        $expiresAt = self::nowUtc()->modify('+' . max(60, $this->ttlSec) . ' seconds');

        $this->emailVerifications->insert([
            'user_id' => $userId,
            'selector' => $token->selector,
            'token_hash' => $token->tokenHashHex(),
            'validator_hash' => $validatorHash,
            'key_version' => $keyVersion,
            'expires_at' => self::formatSqlDateTime($expiresAt),
        ]);

        return $token;
    }

    /**
     * Verify the token and activate the user (is_active=1).
     *
     * @throws EmailVerificationException
     * @param array<string,mixed>|null $meta
     */
    public function verifyAndActivate(
        string $token,
        ?string $clientIp = null,
        ?string $userAgent = null,
        ?array $meta = null,
    ): int {
        $parsed = EmailVerificationToken::parse($token);
        if ($parsed === null) {
            $this->recordVerifyEvent(null, false, $clientIp, $userAgent, ['reason' => 'invalid_token']);
            throw new EmailVerificationException('invalid_token');
        }

        $expectedHash = $parsed->validatorHashBinary();
        if (!is_string($expectedHash) || strlen($expectedHash) !== 32) {
            $this->recordVerifyEvent(null, false, $clientIp, $userAgent, ['reason' => 'invalid_token']);
            throw new EmailVerificationException('invalid_token');
        }

        $now = self::nowUtc();
        $selector = $parsed->selector;

        $outcome = $this->db->transaction(function () use ($selector, $expectedHash, $now): array {
            $row = $this->emailVerifications->getByUnique(['selector' => $selector]);
            if (!is_array($row) || !isset($row['id'])) {
                throw new EmailVerificationException('invalid_token');
            }

            $id = (int)$row['id'];
            $locked = $this->emailVerifications->lockById($id, 'wait', 'update');
            if (is_array($locked)) {
                $row = $locked;
            }

            $userId = isset($row['user_id']) ? (int)$row['user_id'] : 0;
            if ($userId <= 0) {
                throw new EmailVerificationException('user_not_found');
            }

            if (!empty($row['used_at'])) {
                throw new EmailVerificationException('token_used');
            }

            $expiresAt = self::parseSqlDateTime($row['expires_at'] ?? null);
            if ($expiresAt === null || $expiresAt <= $now) {
                throw new EmailVerificationException('expired_token');
            }

            $storedHash = BinaryCodec::toBinary($row['validator_hash'] ?? null);
            if (!is_string($storedHash) || strlen($storedHash) !== 32) {
                throw new EmailVerificationException('invalid_token');
            }

            if (!hash_equals($storedHash, $expectedHash)) {
                throw new EmailVerificationException('invalid_token');
            }

            $this->emailVerifications->updateById($id, ['used_at' => self::formatSqlDateTime($now)]);
            $this->users->updateById($userId, ['is_active' => 1, 'is_locked' => 0]);

            return ['user_id' => $userId];
        });

        $userId = (int)($outcome['user_id'] ?? 0);
        $eventMeta = is_array($meta) ? $meta : [];
        $eventMeta['selector'] = $selector;
        $this->recordVerifyEvent($userId > 0 ? $userId : null, true, $clientIp, $userAgent, $eventMeta);

        if ($userId <= 0) {
            throw new EmailVerificationException('user_not_found');
        }
        return $userId;
    }

    /** @param array<string,mixed> $meta */
    private function recordVerifyEvent(?int $userId, bool $success, ?string $clientIp, ?string $userAgent, array $meta): void
    {
        if ($this->verifyEvents === null) {
            return;
        }

        $type = $success ? 'verify_success' : 'verify_failure';
        $ip = self::resolveClientIp($clientIp);
        $ua = $userAgent ?? ($_SERVER['HTTP_USER_AGENT'] ?? null);

        $ipHash = null;
        $ipKeyVer = null;

        if ($ip !== null) {
            $adapter = self::criteriaAdapter();
            if ($adapter !== null) {
                try {
                    $criteria = $adapter->criteria('verify_events', ['ip_hash' => $ip]);
                    $ipHash = BinaryCodec::toBinary($criteria['ip_hash'] ?? null);
                    $ipKeyVer = $criteria['ip_hash_key_version'] ?? null;
                    if (!is_string($ipHash) || strlen($ipHash) !== 32) {
                        $ipHash = null;
                        $ipKeyVer = null;
                    }
                } catch (\Throwable) {
                    $ipHash = null;
                    $ipKeyVer = null;
                }
            }
        }

        $metaPayload = [];
        foreach ($meta as $k => $v) {
            if (!is_string($k) || $k === '') {
                continue;
            }
            if (is_scalar($v) || $v === null || is_array($v)) {
                $metaPayload[$k] = $v;
            } else {
                $metaPayload[$k] = (string)$v;
            }
        }

        try {
            $metaJson = null;
            if ($metaPayload !== []) {
                $encoded = json_encode($metaPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                $metaJson = $encoded === false ? null : $encoded;
            }
            $this->verifyEvents->insert([
                'user_id' => $userId,
                'type' => $type,
                'ip_hash' => $ipHash,
                'ip_hash_key_version' => is_string($ipKeyVer) && $ipKeyVer !== '' ? $ipKeyVer : null,
                'user_agent' => is_string($ua) && $ua !== '' ? $ua : null,
                'meta' => $metaJson,
            ]);
        } catch (\Throwable) {
        }
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

    private static function resolveClientIp(?string $ip): ?string
    {
        $ip = is_string($ip) ? trim($ip) : null;
        if ($ip !== null && $ip !== '') {
            return $ip;
        }
        $remote = $_SERVER['REMOTE_ADDR'] ?? null;
        $remote = is_string($remote) ? trim($remote) : null;
        return ($remote !== null && $remote !== '') ? $remote : null;
    }

    private static function nowUtc(): \DateTimeImmutable
    {
        return new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    private static function parseSqlDateTime(mixed $value): ?\DateTimeImmutable
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }
        try {
            return new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
        } catch (\Throwable) {
            return null;
        }
    }

    private static function formatSqlDateTime(\DateTimeImmutable $dt): string
    {
        return $dt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
    }
}
