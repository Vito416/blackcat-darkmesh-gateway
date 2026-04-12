<?php
declare(strict_types=1);

namespace BlackCat\Auth\PasswordReset;

use BlackCat\Auth\Identity\EmailHasherInterface;
use BlackCat\Auth\Password\PasswordHasher;
use BlackCat\Core\Database;
use BlackCat\Database\Packages\PasswordResets\Repository\PasswordResetRepositoryInterface;
use BlackCat\Database\Packages\Users\Repository\UserRepositoryInterface;
use BlackCat\Database\Support\BinaryCodec;

final class PasswordResetService
{
    public function __construct(
        private readonly Database $db,
        private readonly PasswordResetRepositoryInterface $passwordResets,
        private readonly UserRepositoryInterface $users,
        private readonly PasswordHasher $passwords,
        private readonly EmailHasherInterface $emails,
        private readonly int $ttlSec = 3600,
        private readonly int $passwordMinLength = 8,
    ) {}

    public function ttlSec(): int
    {
        return $this->ttlSec;
    }

    public function issueForEmail(
        string $email,
        ?string $keyVersion = null,
        ?string $clientIp = null,
        ?string $userAgent = null,
    ): ?PasswordResetToken {
        $normalized = $this->emails->normalize($email);
        if ($normalized === '' || !filter_var($normalized, FILTER_VALIDATE_EMAIL)) {
            return null;
        }

        $user = $this->users->getByUnique(['email_hash' => $normalized]);
        if (!is_array($user) || !isset($user['id'])) {
            return null;
        }
        $userId = (int)$user['id'];
        if ($userId <= 0) {
            return null;
        }

        $token = PasswordResetToken::issue();
        $validatorHash = $token->validatorHashBinary();
        if (!is_string($validatorHash) || strlen($validatorHash) !== 32) {
            throw new PasswordResetException('invalid_token');
        }

        $expiresAt = self::nowUtc()->modify('+' . max(60, $this->ttlSec) . ' seconds');

        $ip = self::resolveClientIp($clientIp);
        $ua = $userAgent ?? ($_SERVER['HTTP_USER_AGENT'] ?? null);
        $ua = is_string($ua) ? trim($ua) : null;

        $this->passwordResets->insert([
            'user_id' => $userId,
            'selector' => $token->selector,
            'token_hash' => $token->tokenHashHex(),
            'validator_hash' => $validatorHash,
            'key_version' => $keyVersion,
            'expires_at' => self::formatSqlDateTime($expiresAt),
            'ip_hash' => $ip !== null ? $ip : null,
            'user_agent' => $ua !== '' ? $ua : null,
        ]);

        return $token;
    }

    /**
     * Consume a reset token and set a new password.
     *
     * @throws PasswordResetException
     * @param array<string,mixed>|null $meta
     */
    public function resetPassword(
        string $token,
        string $newPassword,
        ?string $clientIp = null,
        ?string $userAgent = null,
        ?array $meta = null,
    ): int {
        $min = max(1, $this->passwordMinLength);
        if (mb_strlen($newPassword, 'UTF-8') < $min) {
            throw new PasswordResetException('weak_password', 'password_min_length:' . $min);
        }

        $parsed = PasswordResetToken::parse($token);
        if ($parsed === null) {
            throw new PasswordResetException('invalid_token');
        }

        $expectedHash = $parsed->validatorHashBinary();
        if (!is_string($expectedHash) || strlen($expectedHash) !== 32) {
            throw new PasswordResetException('invalid_token');
        }

        $now = self::nowUtc();
        $selector = $parsed->selector;

        $outcome = $this->db->transaction(function () use ($selector, $expectedHash, $now, $newPassword): array {
            $row = $this->passwordResets->getByUnique(['selector' => $selector]);
            if (!is_array($row) || !isset($row['id'])) {
                throw new PasswordResetException('invalid_token');
            }

            $id = (int)$row['id'];
            $locked = $this->passwordResets->lockById($id, 'wait', 'update');
            if (is_array($locked)) {
                $row = $locked;
            }

            $userId = isset($row['user_id']) ? (int)$row['user_id'] : 0;
            if ($userId <= 0) {
                throw new PasswordResetException('user_not_found');
            }

            if (!empty($row['used_at'])) {
                throw new PasswordResetException('token_used');
            }

            $expiresAt = self::parseSqlDateTime($row['expires_at'] ?? null);
            if ($expiresAt === null || $expiresAt <= $now) {
                throw new PasswordResetException('expired_token');
            }

            $storedHash = BinaryCodec::toBinary($row['validator_hash'] ?? null);
            if (!is_string($storedHash) || strlen($storedHash) !== 32) {
                throw new PasswordResetException('invalid_token');
            }
            if (!hash_equals($storedHash, $expectedHash)) {
                throw new PasswordResetException('invalid_token');
            }

            $hash = $this->passwords->hash($newPassword);
            $algo = $this->passwords->algorithmName($hash);
            $pepperVersion = $this->passwords->currentPepperVersion();

            $this->passwordResets->updateById($id, ['used_at' => self::formatSqlDateTime($now)]);
            $this->users->updateById($userId, [
                'password_hash' => $hash,
                'password_algo' => $algo,
                'password_key_version' => $pepperVersion,
                'must_change_password' => 0,
                'failed_logins' => 0,
                'is_locked' => 0,
            ]);

            return ['user_id' => $userId];
        });

        $userId = (int)($outcome['user_id'] ?? 0);
        if ($userId <= 0) {
            throw new PasswordResetException('user_not_found');
        }

        return $userId;
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
