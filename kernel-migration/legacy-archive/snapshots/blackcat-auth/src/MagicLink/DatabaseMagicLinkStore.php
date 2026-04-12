<?php
declare(strict_types=1);

namespace BlackCat\Auth\MagicLink;

use BlackCat\Core\Database;
use BlackCat\Database\Crypto\IngressLocator;
use BlackCat\Database\Packages\MagicLinks\Repository\MagicLinkRepository;

final class DatabaseMagicLinkStore implements MagicLinkStoreInterface
{
    private MagicLinkRepository $links;

    public function __construct(
        Database $db,
        ?MagicLinkRepository $links = null,
    ) {
        $this->links = $links ?? new MagicLinkRepository($db);
    }

    public function save(MagicLinkToken $token): void
    {
        $expiresAt = self::formatSqlDateTimeFromEpoch($token->expiresAt);
        $context = self::encodeJson($token->context) ?? '{}';
        $userId = ctype_digit($token->subject) ? (int)$token->subject : null;

        $this->links->upsert([
            'fingerprint' => $token->fingerprint,
            'subject' => $token->subject,
            'user_id' => $userId,
            'context' => $context,
            'expires_at' => $expiresAt,
        ]);
    }

    public function find(string $fingerprint): ?MagicLinkToken
    {
        $fingerprint = trim($fingerprint);
        if ($fingerprint === '') {
            return null;
        }

        $row = $this->links->getByFingerprint($fingerprint, false);
        if (!is_array($row) || !isset($row['id'])) {
            return null;
        }

        $subject = is_string($row['subject'] ?? null) ? trim((string)$row['subject']) : '';
        if ($subject === '') {
            return null;
        }

        $expiresAt = self::parseSqlDateTimeToEpoch($row['expires_at'] ?? null);
        if ($expiresAt <= 0) {
            return null;
        }

        $context = $this->decodeJsonObject('magic_links', $row['context'] ?? null) ?? [];

        return new MagicLinkToken($fingerprint, $subject, $context, $expiresAt);
    }

    public function delete(string $fingerprint): void
    {
        $fingerprint = trim($fingerprint);
        if ($fingerprint === '') {
            return;
        }

        $row = $this->links->getByFingerprint($fingerprint, false);
        $id = is_array($row) ? (int)($row['id'] ?? 0) : 0;
        if ($id <= 0) {
            return;
        }
        $this->links->deleteById($id);
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

        // JSON column may contain:
        // - plaintext object: {"a":1}
        // - encrypted payload as JSON string: "BASE64..."
        $decoded = json_decode($rawStr, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        $ciphertext = is_string($decoded) ? $decoded : $rawStr;

        $plain = self::maybeDecrypt($table, ['context' => $ciphertext]);
        if ($plain !== null) {
            $maybe = $plain['context'] ?? null;
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
