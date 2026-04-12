<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Hmac;

use BlackCat\Crypto\Keyring\KeyRegistry;
use Psr\Log\LoggerInterface;

final class HmacService
{
    public function __construct(private readonly KeyRegistry $registry, private readonly ?LoggerInterface $logger = null) {}

    public function sign(string $slot, string $message): string
    {
        return $this->signWithKeyId($slot, $message)['signature'];
    }

    /**
     * @return array{signature:string, keyId:string}
     */
    public function signWithKeyId(string $slot, string $message): array
    {
        $key = $this->registry->deriveAeadKey($slot);
        return [
            // DB-facing HMACs are stored in fixed-length binary columns (typically 32 bytes),
            // so we standardize on HMAC-SHA256 (32-byte output) for deterministic lookups.
            'signature' => hash_hmac('sha256', $message, $key->bytes, true),
            'keyId' => $key->id,
        ];
    }

    /**
     * Compute signature candidates for all available keys (newest -> oldest).
     *
     * Useful for DB lookups where *_key_version is unknown (query via IN (...) over candidates).
     *
     * @return list<array{signature:string, keyId:string}>
     */
    public function candidates(string $slot, string $message, ?int $maxCandidates = 20): array
    {
        $materials = $this->registry->all($slot);
        if (!$materials) {
            return [];
        }

        $out = [];
        $count = 0;
        for ($i = count($materials) - 1; $i >= 0; $i--) {
            if ($maxCandidates !== null && $count >= $maxCandidates) {
                break;
            }
            $mat = $materials[$i];
            $out[] = [
                'signature' => hash_hmac('sha256', $message, $mat->bytes, true),
                'keyId' => $mat->id,
            ];
            $count++;
        }
        return $out;
    }

    public function verify(string $slot, string $message, string $signature): bool
    {
        return $this->verifyWithKeyId($slot, $message, $signature, null);
    }

    /**
     * Verify a signature against either:
     * - a specific key id (fast-path; use *_key_version), or
     * - all available keys (rotation-safe).
     */
    public function verifyWithKeyId(string $slot, string $message, string $signature, ?string $keyId): bool
    {
        if ($keyId !== null && $keyId !== '') {
            try {
                $key = $this->registry->deriveAeadKey($slot, $keyId);
                $calc = hash_hmac('sha256', $message, $key->bytes, true);
                if (hash_equals($calc, $signature)) {
                    return true;
                }
            } catch (\Throwable $e) {
                $this->logger?->debug('hmac verifyWithKeyId failed', [
                    'slot' => $slot,
                    'keyId' => $keyId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Fallback: try all available key versions (rotation-safe).
        foreach ($this->candidates($slot, $message, null) as $cand) {
            if (hash_equals($cand['signature'], $signature)) {
                return true;
            }
        }
        return false;
    }
}
