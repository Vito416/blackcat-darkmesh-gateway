<?php
declare(strict_types=1);

namespace BlackCat\Auth\WebAuthn;

use BlackCat\Core\Database;
use BlackCat\Database\Crypto\IngressLocator;
use BlackCat\Database\Packages\WebauthnChallenges\Criteria as WebauthnChallengesCriteria;
use BlackCat\Database\Packages\WebauthnChallenges\Repository\WebauthnChallengeRepository;
use BlackCat\Database\Packages\WebauthnCredentials\Criteria as WebauthnCredentialsCriteria;
use BlackCat\Database\Packages\WebauthnCredentials\Repository\WebauthnCredentialRepository;

final class DatabaseWebAuthnStore implements WebAuthnStoreInterface
{
    private WebauthnCredentialRepository $credentials;
    private WebauthnChallengeRepository $challenges;
    private int $lastChallengeCleanupAt = 0;

    public function __construct(
        private readonly Database $db,
        private readonly string $rpId,
        ?WebauthnCredentialRepository $credentials = null,
        ?WebauthnChallengeRepository $challenges = null,
        private readonly int $challengeTtlSec = 600,
    ) {
        $this->credentials = $credentials ?? new WebauthnCredentialRepository($db);
        $this->challenges = $challenges ?? new WebauthnChallengeRepository($db);
    }

    public function saveCredentials(string $subject, array $credentials): void
    {
        $subject = trim($subject);
        if ($subject === '') {
            return;
        }

        $existing = $this->loadCredentialRows($subject);
        $existingByCredentialId = [];
        foreach ($existing as $row) {
            $credId = is_string($row['credential_id'] ?? null) ? (string)$row['credential_id'] : '';
            if ($credId !== '' && isset($row['id'])) {
                $existingByCredentialId[$credId] = (int)$row['id'];
            }
        }

        $userId = ctype_digit($subject) ? (int)$subject : null;

        $newIds = [];
        foreach ($credentials as $cred) {
            if (!$cred instanceof WebAuthnCredential) {
                continue;
            }
            $credentialId = trim($cred->id);
            $publicKey = trim($cred->publicKey);
            if ($credentialId === '' || $publicKey === '') {
                continue;
            }

            $newIds[$credentialId] = true;

            $this->credentials->upsert([
                'rp_id' => $this->rpId,
                'subject' => $subject,
                'user_id' => $userId,
                'credential_id' => $credentialId,
                'public_key' => $publicKey,
                'added_at' => self::formatSqlDateTimeFromEpoch($cred->addedAt),
            ]);
        }

        foreach ($existingByCredentialId as $credId => $id) {
            if (isset($newIds[$credId])) {
                continue;
            }
            if ($id > 0) {
                $this->credentials->deleteById($id);
            }
        }
    }

    public function loadCredentials(string $subject): array
    {
        $rows = $this->loadCredentialRows($subject);
        if ($rows === []) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $credentialId = is_string($row['credential_id'] ?? null) ? trim((string)$row['credential_id']) : '';
            $publicKey = is_string($row['public_key'] ?? null) ? (string)$row['public_key'] : '';
            if ($credentialId === '' || $publicKey === '') {
                continue;
            }
            $addedAt = self::parseSqlDateTimeToEpoch($row['added_at'] ?? null);
            $out[] = new WebAuthnCredential($credentialId, $publicKey, $addedAt > 0 ? $addedAt : time());
        }
        return $out;
    }

    /** @param array<string,mixed> $metadata */
    public function rememberChallenge(string $challenge, array $metadata): void
    {
        $challenge = trim($challenge);
        if ($challenge === '') {
            return;
        }

        $this->maybeCleanupExpiredChallenges();

        $expiresAt = time() + max(30, $this->challengeTtlSec);
        $metadataJson = self::encodeJson($metadata) ?? '{}';

        $this->challenges->upsert([
            'rp_id' => $this->rpId,
            'challenge_hash' => $challenge,
            'metadata' => $metadataJson,
            'expires_at' => self::formatSqlDateTimeFromEpoch($expiresAt),
        ]);
    }

    /** @return array<string,mixed>|null */
    public function consumeChallenge(string $challenge): ?array
    {
        $challenge = trim($challenge);
        if ($challenge === '') {
            return null;
        }

        $this->maybeCleanupExpiredChallenges();

        $row = $this->challenges->getByRpIdAndChallengeHash($this->rpId, $challenge, false);
        if (!is_array($row) || !isset($row['id'])) {
            return null;
        }

        $id = (int)$row['id'];
        if ($id <= 0) {
            return null;
        }

        $expiresAt = self::parseSqlDateTimeToEpoch($row['expires_at'] ?? null);
        if ($expiresAt > 0 && $expiresAt <= time()) {
            $this->challenges->deleteById($id);
            return null;
        }

        $this->challenges->deleteById($id);

        return $this->decodeJsonObject('webauthn_challenges', $row['metadata'] ?? null) ?? null;
    }

    public function touchCredential(string $subject, string $credentialId, ?int $signCount = null): bool
    {
        $subject = trim($subject);
        $credentialId = trim($credentialId);
        if ($subject === '' || $credentialId === '') {
            return false;
        }

        try {
            $row = $this->credentials->getByRpIdAndCredentialId($this->rpId, $credentialId, false);
        } catch (\Throwable) {
            return false;
        }

        if (!is_array($row) || !isset($row['id'])) {
            return false;
        }

        $rowSubject = is_string($row['subject'] ?? null) ? (string)$row['subject'] : '';
        if ($rowSubject !== $subject) {
            return false;
        }

        $id = (int)$row['id'];
        if ($id <= 0) {
            return false;
        }

        $stored = isset($row['sign_count']) ? (int)$row['sign_count'] : 0;
        $update = [
            'last_used_at' => self::formatSqlDateTimeFromEpoch(time()),
        ];

        if ($signCount !== null) {
            $signCount = (int)$signCount;
            if ($signCount < 0) {
                $signCount = 0;
            }

            // RFC: if signCount is supported, it must be strictly increasing.
            if ($signCount === 0 && $stored === 0) {
                // Some authenticators always return 0 (no counter support).
            } elseif ($signCount > $stored) {
                $update['sign_count'] = $signCount;
            } else {
                return false;
            }
        }

        try {
            $this->credentials->updateById($id, $update);
        } catch (\Throwable) {
            // Best-effort; authentication already succeeded logically.
        }

        return true;
    }

    private function maybeCleanupExpiredChallenges(): void
    {
        $now = time();
        if ($this->lastChallengeCleanupAt > 0 && ($now - $this->lastChallengeCleanupAt) < 60) {
            return;
        }
        $this->lastChallengeCleanupAt = $now;
        $this->cleanupExpiredChallenges(200);
    }

    private function cleanupExpiredChallenges(int $limit): void
    {
        $limit = max(1, min(1000, $limit));
        $cutoff = self::formatSqlDateTimeFromEpoch(time());

        try {
            $criteria = WebauthnChallengesCriteria::fromDb($this->db)
                ->where('rp_id', '=', $this->rpId)
                ->where('expires_at', '<=', $cutoff)
                ->orderBy('expires_at', 'ASC')
                ->setPerPage($limit)
                ->setPage(1);

            $page = $this->challenges->paginate($criteria);
            $items = $page['items'];
            if ($items === []) {
                return;
            }
            foreach ($items as $row) {
                $id = isset($row['id']) ? (int)$row['id'] : 0;
                if ($id > 0) {
                    try {
                        $this->challenges->deleteById($id);
                    } catch (\Throwable) {
                    }
                }
            }
        } catch (\Throwable) {
        }
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function loadCredentialRows(string $subject): array
    {
        $subject = trim($subject);
        if ($subject === '') {
            return [];
        }

        $criteria = WebauthnCredentialsCriteria::fromDb($this->db)
            ->where('rp_id', '=', $this->rpId)
            ->where('subject', '=', $subject)
            ->orderBy('added_at', 'ASC')
            ->setPerPage(500)
            ->setPage(1);

        $page = $this->credentials->paginate($criteria);
        return $page['items'];
    }

    /**
     * @return array<string,mixed>|null
     */
    private function decodeJsonObject(string $table, mixed $raw): ?array
    {
        if (is_array($raw)) {
            return $raw;
        }
        if ($raw === null) {
            return null;
        }

        $rawStr = is_string($raw) ? trim($raw) : '';
        if ($rawStr === '') {
            return null;
        }

        $decoded = json_decode($rawStr, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        $ciphertext = is_string($decoded) ? $decoded : $rawStr;

        $plain = self::maybeDecrypt($table, ['metadata' => $ciphertext]);
        if ($plain !== null) {
            $maybe = $plain['metadata'] ?? null;
            if (is_string($maybe) && trim($maybe) !== '') {
                $ciphertext = $maybe;
            }
        }

        $obj = json_decode($ciphertext, true);
        return is_array($obj) ? $obj : null;
    }

    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>|null
     */
    private static function maybeDecrypt(string $table, array $payload): ?array
    {
        try {
            $adapter = IngressLocator::adapter();
        } catch (\Throwable) {
            return null;
        }
        if ($adapter === null || !method_exists($adapter, 'decrypt')) {
            return null;
        }
        try {
            /** @var array<string,mixed> */
            return $adapter->decrypt($table, $payload, ['strict' => false]);
        } catch (\Throwable) {
            return null;
        }
    }

    private static function encodeJson(mixed $value): ?string
    {
        $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json !== false) {
            return $json;
        }
        $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
        return $json === false ? null : $json;
    }

    private static function parseSqlDateTimeToEpoch(mixed $value): int
    {
        if (!is_string($value) || trim($value) === '') {
            return 0;
        }
        try {
            $dt = new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
            return $dt->getTimestamp();
        } catch (\Throwable) {
            return 0;
        }
    }

    private static function formatSqlDateTimeFromEpoch(int $epochSec): string
    {
        $epochSec = max(0, $epochSec);
        $dt = (new \DateTimeImmutable('@' . $epochSec))->setTimezone(new \DateTimeZone('UTC'));
        return $dt->format('Y-m-d H:i:s.u');
    }
}
