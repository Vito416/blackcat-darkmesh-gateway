<?php
declare(strict_types=1);

namespace BlackCat\Auth\DeviceCode;

use BlackCat\Core\Database;
use BlackCat\Database\Crypto\IngressLocator;
use BlackCat\Database\Packages\DeviceCodes\Repository\DeviceCodeRepository;
use BlackCat\Database\Support\BinaryCodec;

final class DatabaseDeviceCodeStore implements DeviceCodeStoreInterface
{
    private DeviceCodeRepository $codes;
    private ?bool $ingressAvailable = null;

    public function __construct(
        Database $db,
        ?DeviceCodeRepository $codes = null,
    ) {
        $this->codes = $codes ?? new DeviceCodeRepository($db);
    }

    public function save(DeviceCodeEntry $entry): void
    {
        $deviceCode = trim($entry->deviceCode);
        $userCode = trim($entry->userCode);
        if ($deviceCode === '' || $userCode === '') {
            return;
        }

        $scopesJson = self::encodeJson($entry->scopes) ?? '[]';
        $expiresAt = self::formatSqlDateTimeFromEpoch($entry->expiresAt);

        $row = [
            'device_code_hash' => $this->hashForIngressOrSha256($deviceCode),
            'device_code' => $deviceCode,
            'user_code_hash' => $this->hashForIngressOrSha256($userCode),
            'client_id' => $entry->clientId,
            'scopes' => $scopesJson,
            'interval_sec' => $entry->interval,
            'expires_at' => $expiresAt,
        ];

        if (!$entry->isApproved()) {
            $this->codes->upsert($row);
            return;
        }

        $payloadJson = self::encodeJson($entry->tokens());
        if ($payloadJson === null) {
            return;
        }

        // We intentionally UPDATE by selector (user_code_hash) to avoid needing device_code plaintext.
        $existing = $this->codes->getByUserCodeHash($this->hashForIngressOrSha256($userCode), false);
        if (!is_array($existing) || !isset($existing['id'])) {
            $existing = $this->codes->getByDeviceCodeHash($this->hashForIngressOrSha256($deviceCode), false);
        }

        $id = is_array($existing) ? (int)($existing['id'] ?? 0) : 0;
        if ($id <= 0) {
            $row['token_payload'] = $payloadJson;
            $row['approved_at'] = self::formatSqlDateTimeFromEpoch(time());
            $this->codes->upsert($row);
            return;
        }

        $this->codes->updateById($id, [
            'token_payload' => $payloadJson,
            'approved_at' => self::formatSqlDateTimeFromEpoch(time()),
        ]);
    }

    public function findByDeviceCode(string $deviceCode): ?DeviceCodeEntry
    {
        $deviceCode = trim($deviceCode);
        if ($deviceCode === '') {
            return null;
        }

        $row = $this->codes->getByDeviceCodeHash($this->hashForIngressOrSha256($deviceCode), false);
        if (!is_array($row)) {
            return null;
        }

        return $this->hydrateEntry($row, $deviceCode, '');
    }

    public function findByUserCode(string $userCode): ?DeviceCodeEntry
    {
        $userCode = trim($userCode);
        if ($userCode === '') {
            return null;
        }

        $row = $this->codes->getByUserCodeHash($this->hashForIngressOrSha256($userCode), false);
        if (!is_array($row)) {
            return null;
        }

        // We cannot recover device_code from DB (it is intentionally hidden); store userCode in deviceCode slot.
        return $this->hydrateEntry($row, $userCode, $userCode);
    }

    public function delete(string $deviceCode): void
    {
        $deviceCode = trim($deviceCode);
        if ($deviceCode === '') {
            return;
        }

        $row = $this->codes->getByDeviceCodeHash($this->hashForIngressOrSha256($deviceCode), false);
        if (!is_array($row)) {
            // Allow deleting by user_code as a fallback.
            $row = $this->codes->getByUserCodeHash($this->hashForIngressOrSha256($deviceCode), false);
        }

        $id = is_array($row) ? (int)($row['id'] ?? 0) : 0;
        if ($id <= 0) {
            return;
        }
        $this->codes->deleteById($id);
    }

    /**
     * @param array<string,mixed> $row Contract-view row.
     */
    private function hydrateEntry(array $row, string $deviceCode, string $userCode): ?DeviceCodeEntry
    {
        $clientId = is_string($row['client_id'] ?? null) ? trim((string)$row['client_id']) : '';
        if ($clientId === '') {
            return null;
        }

        $scopes = self::decodeJsonArray($row['scopes'] ?? null) ?? [];
        $interval = isset($row['interval_sec']) ? (int)$row['interval_sec'] : 5;
        $expiresAt = self::parseSqlDateTimeToEpoch($row['expires_at'] ?? null);
        if ($expiresAt <= 0) {
            return null;
        }

        $tokenPayload = $this->decodeTokenPayload($row['token_payload'] ?? null);

        return new DeviceCodeEntry(
            $deviceCode,
            $userCode,
            $clientId,
            $scopes,
            $expiresAt,
            $interval,
            $tokenPayload
        );
    }

    /**
     * @return array<string,mixed>|null
     */
    private function decodeTokenPayload(mixed $raw): ?array
    {
        if ($raw === null || $raw === '') {
            return null;
        }

        $blob = BinaryCodec::toBinary($raw);
        if (!is_string($blob) || $blob === '') {
            return null;
        }

        $decrypted = self::maybeDecrypt('device_codes', ['token_payload' => $blob]);
        if ($decrypted !== null) {
            $maybe = BinaryCodec::toBinary($decrypted['token_payload'] ?? null);
            if (is_string($maybe) && $maybe !== '') {
                $blob = $maybe;
            }
        }

        $data = json_decode($blob, true);
        return is_array($data) ? $data : null;
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

    /**
     * @return array<int,mixed>|null
     */
    private static function decodeJsonArray(mixed $raw): ?array
    {
        if (is_array($raw)) {
            return array_values($raw);
        }
        if (!is_string($raw) || trim($raw) === '') {
            return null;
        }
        $data = json_decode($raw, true);
        return is_array($data) ? array_values($data) : null;
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

    private function hashForIngressOrSha256(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        if ($this->ingressIsAvailable()) {
            return $value;
        }

        return hash('sha256', $value, true);
    }

    private function ingressIsAvailable(): bool
    {
        if ($this->ingressAvailable !== null) {
            return $this->ingressAvailable;
        }

        // When required, adapter() throws -> do not swallow (fail-closed).
        $this->ingressAvailable = IngressLocator::adapter() !== null;
        return $this->ingressAvailable;
    }
}
