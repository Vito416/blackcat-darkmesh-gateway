<?php
declare(strict_types=1);

namespace BlackCat\Crypto;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\AEAD\AeadCipherInterface;
use BlackCat\Crypto\AEAD\XChaCha20Cipher;
use BlackCat\Crypto\Hmac\HmacService;
use BlackCat\Crypto\Keyring\KeyRegistry;
use BlackCat\Crypto\Kms\KmsRouter;
use BlackCat\Crypto\Support\Envelope;
use BlackCat\Crypto\Support\Payload;
use BlackCat\Crypto\Rotation\RotationPolicyRegistry;
use BlackCat\Crypto\Queue\WrapQueueInterface;
use BlackCat\Crypto\Queue\WrapJob;
use BlackCat\Crypto\Telemetry\IntentCollector;
use Psr\Log\LoggerInterface;

/**
 * Facade for all cryptography in BlackCat:
 * - AEAD encryption with local keys + HMAC slots
 * - Double-envelope (local AEAD + KMS wrap)
 * - Single entrypoint for other repositories/modules
 */
final class CryptoManager
{
    private KeyRegistry $keyRegistry;
    private AeadCipherInterface $aead;
    private HmacService $hmac;
    private KmsRouter $kms;
    private ?RotationPolicyRegistry $rotationPolicies;
    private ?WrapQueueInterface $wrapQueue;
    private ?LoggerInterface $logger;
    private ?IntentCollector $intents;

    private function __construct(
        KeyRegistry $keyRegistry,
        AeadCipherInterface $aead,
        HmacService $hmac,
        KmsRouter $kms,
        ?RotationPolicyRegistry $rotationPolicies = null,
        ?WrapQueueInterface $wrapQueue = null,
        ?LoggerInterface $logger = null,
        ?IntentCollector $intents = null,
    ) {
        $this->keyRegistry = $keyRegistry;
        $this->aead = $aead;
        $this->hmac = $hmac;
        $this->kms = $kms;
        $this->rotationPolicies = $rotationPolicies;
        $this->wrapQueue = $wrapQueue;
        $this->logger = $logger;
        $this->intents = $intents;
    }

    public static function boot(CryptoConfig $config, ?LoggerInterface $logger = null): self
    {
        $registry = KeyRegistry::fromConfig($config, $logger);
        $aead = $config->aeadFactory()
            ? ($config->aeadFactory())($registry, $logger)
            : self::buildAead($config->aeadDriver(), $registry, $logger);
        $hmac = new HmacService($registry, $logger);
        $kms = new KmsRouter($config->kmsConfig(), $logger);
        $rotation = RotationPolicyRegistry::fromArray($config->rotationPolicies());
        $queueFactory = $config->wrapQueueFactory();
        $queue = $queueFactory ? $queueFactory() : null;
        $manager = new self($registry, $aead, $hmac, $kms, $rotation, $queue, $logger);

        if (getenv('BLACKCAT_CRYPTO_INTENTS')) {
            $collector = new IntentCollector();
            IntentCollector::global($collector);
            $manager = $manager->withIntentCollector($collector);
        }

        return $manager;
    }

    public static function fromComponents(
        KeyRegistry $registry,
        AeadCipherInterface $aead,
        HmacService $hmac,
        KmsRouter $kms,
        ?RotationPolicyRegistry $rotation = null,
        ?WrapQueueInterface $wrapQueue = null,
        ?LoggerInterface $logger = null,
        ?IntentCollector $intents = null,
    ): self {
        return new self($registry, $aead, $hmac, $kms, $rotation, $wrapQueue, $logger, $intents);
    }

    public function withWrapQueue(WrapQueueInterface $queue): self
    {
        $clone = clone $this;
        $clone->wrapQueue = $queue;
        return $clone;
    }

    public function withIntentCollector(IntentCollector $collector): self
    {
        $clone = clone $this;
        $clone->intents = $collector;
        return $clone;
    }

    /**
     * Encrypt plaintext for a logical context (e.g. `users.pii`).
     *
     * Returns an {@see Envelope} which includes metadata (KMS client, local key id, wrap count, ...).
     *
     * @param array<string,mixed> $options
     */
    public function encryptContext(string $context, string $plaintext, array $options = []): Envelope
    {
        $localKey = $this->keyRegistry->deriveAeadKey($context);
        $payload = $this->aead->encrypt($plaintext, $context, $localKey);
        $wrapCount = $options['wrapCount'] ?? 0;

        $wrapped = $this->kms->wrap(
            $context,
            $payload,
            [],
            ['preferredClient' => $options['preferredClient'] ?? null]
        );

        // If a real KMS was used, increment wrap count; local-only metadata keeps the provided value.
        if (($wrapped['client'] ?? 'local') !== 'local') {
            $wrapCount++;
        }

        $wrapped['wrapCount'] = $wrapCount;
        $envelope = Envelope::fromLayers($payload, $wrapped, $context);
        $this->recordIntent('encrypt_context', [
            'context' => $context,
            'localKeyId' => $payload->keyId,
            'kmsClient' => $wrapped['client'] ?? null,
            'wrapCount' => $wrapCount,
        ]);
        $this->maybeScheduleRotation($envelope);
        return $envelope;
    }

    /**
     * Decrypt envelope using metadata to pick the correct KMS client and local key id.
     *
     * @param array{skipRotation?:bool} $options
     */
    public function decryptContext(string $context, string $serializedEnvelope, array $options = []): string
    {
        $envelope = Envelope::decode($serializedEnvelope);
        $wrapped = $this->kms->unwrap($context, $envelope->kmsMetadata);

        $hintKeyId = $envelope->local->keyId;
        $tried = [];
        $lastError = null;

        try {
            $localKey = $this->keyRegistry->deriveAeadKey($context, $hintKeyId);
            $tried[$localKey->id] = true;
            $plaintext = $this->aead->decrypt($wrapped, $context, $localKey);
            if (!($options['skipRotation'] ?? false)) {
                $this->maybeScheduleRotation($envelope);
            }
            $this->recordIntent('decrypt_context', [
                'context' => $context,
                'localKeyId' => $localKey->id,
                'kmsClient' => $envelope->kmsMetadata['client'] ?? null,
                'wrapCount' => $envelope->kmsMetadata['wrapCount'] ?? null,
            ]);
            return $plaintext;
        } catch (\Throwable $e) {
            $lastError = $e;
        }

        // Fallback: try all available key versions (rotation-safe).
        try {
            foreach ($this->keyRegistry->all($context) as $candidate) {
                if (isset($tried[$candidate->id])) {
                    continue;
                }
                $tried[$candidate->id] = true;
                try {
                    $plaintext = $this->aead->decrypt($wrapped, $context, $candidate);
                    if (!($options['skipRotation'] ?? false)) {
                        $this->maybeScheduleRotation($envelope);
                    }
                    $this->recordIntent('decrypt_context', [
                        'context' => $context,
                        'localKeyId' => $candidate->id,
                        'kmsClient' => $envelope->kmsMetadata['client'] ?? null,
                        'wrapCount' => $envelope->kmsMetadata['wrapCount'] ?? null,
                        'fallback' => true,
                        'hintKeyId' => $hintKeyId,
                    ]);
                    return $plaintext;
                } catch (\Throwable $inner) {
                    $lastError = $inner;
                    continue;
                }
            }
        } catch (\Throwable $e) {
            $lastError = $e;
        }

        throw $lastError;
    }

    /**
     * Convenience helper for local-only encryption without KMS (e.g. ephemeral secrets).
     */
    public function encryptLocal(string $slot, string $plaintext): Payload
    {
        $key = $this->keyRegistry->deriveAeadKey($slot);
        $payload = $this->aead->encrypt($plaintext, $slot, $key);
        $this->recordIntent('encrypt_local', [
            'slot' => $slot,
            'keyId' => $payload->keyId,
        ]);
        return $payload;
    }

    public function decryptLocal(string $slot, Payload $payload): string
    {
        $key = $this->keyRegistry->deriveAeadKey($slot, $payload->keyId);
        $plaintext = $this->aead->decrypt($payload, $slot, $key);
        $this->recordIntent('decrypt_local', [
            'slot' => $slot,
            'keyId' => $payload->keyId,
            'success' => true,
        ]);
        return $plaintext;
    }

    public function decryptLocalWithAnyKey(string $slot, string $nonce, string $ciphertext, ?string $preferredKeyId = null): ?string
    {
        $materials = $this->keyRegistry->all($slot);
        if ($preferredKeyId !== null) {
            usort($materials, static function ($a, $b) use ($preferredKeyId): int {
                $aPreferred = ($a->id === $preferredKeyId) ? 0 : 1;
                $bPreferred = ($b->id === $preferredKeyId) ? 0 : 1;
                return $aPreferred <=> $bPreferred;
            });
        }
        foreach ($materials as $material) {
            try {
                $payload = new Payload($ciphertext, $nonce, $material->id);
                $out = $this->decryptLocal($slot, $payload);
                return $out;
            } catch (\Throwable $e) {
                $this->logger?->debug('decryptLocalWithAnyKey failed candidate', [
                    'slot' => $slot,
                    'key' => $material->id,
                    'error' => $e->getMessage(),
                ]);
                // Legacy payloads (v2) were encrypted without AAD; try an empty AAD as a fallback.
                try {
                    $payload = new Payload($ciphertext, $nonce, $material->id);
                    $key = $this->keyRegistry->deriveAeadKey($slot, $material->id);
                    $out = $this->aead->decrypt($payload, '', $key);
                    $this->recordIntent('decrypt_local', [
                        'slot' => $slot,
                        'keyId' => $material->id,
                        'success' => true,
                        'aad' => 'empty',
                    ]);
                    return $out;
                } catch (\Throwable $fallback) {
                    $this->logger?->debug('decryptLocalWithAnyKey empty-AAD fallback failed', [
                        'slot' => $slot,
                        'key' => $material->id,
                        'error' => $fallback->getMessage(),
                    ]);
                }
                continue;
            }
        }

        if ($this->logger) {
            try {
                $this->logger->warning('decryptLocalWithAnyKey exhausted all candidates', ['slot' => $slot]);
            } catch (\Throwable $_) {
            }
        }

        $this->recordIntent('decrypt_local', [
            'slot' => $slot,
            'keyId' => null,
            'success' => false,
        ]);
        return null;
    }

    /**
     * HMAC signature + key id used for signing (useful for DB key_version columns).
     *
     * @return array{signature:string, keyId:string}
     */
    public function hmacWithKeyId(string $slot, string $message): array
    {
        $out = $this->hmac->signWithKeyId($slot, $message);
        $this->recordIntent('hmac', [
            'slot' => $slot,
            'messageBytes' => strlen($message),
            'keyId' => $out['keyId'],
        ]);
        return $out;
    }

    public function hmac(string $slot, string $message): string
    {
        return $this->hmacWithKeyId($slot, $message)['signature'];
    }

    /**
     * @return list<array{signature:string, keyId:string}>
     */
    public function hmacCandidates(string $slot, string $message, ?int $maxCandidates = 20): array
    {
        $out = $this->hmac->candidates($slot, $message, $maxCandidates);
        $this->recordIntent('hmac_candidates', [
            'slot' => $slot,
            'messageBytes' => strlen($message),
            'candidates' => count($out),
        ]);
        return $out;
    }

    public function verifyHmac(string $slot, string $message, string $signature): bool
    {
        $ok = $this->hmac->verify($slot, $message, $signature);
        $this->recordIntent('verify_hmac', [
            'slot' => $slot,
            'messageBytes' => strlen($message),
            'signatureBytes' => strlen($signature),
            'success' => $ok,
        ]);
        return $ok;
    }

    public function verifyHmacWithKeyId(string $slot, string $message, string $signature, ?string $keyId): bool
    {
        $ok = $this->hmac->verifyWithKeyId($slot, $message, $signature, $keyId);
        $this->recordIntent('verify_hmac', [
            'slot' => $slot,
            'messageBytes' => strlen($message),
            'signatureBytes' => strlen($signature),
            'keyId' => $keyId,
            'success' => $ok,
        ]);
        return $ok;
    }

    public function keyMaterial(string $slot, ?string $forceKeyId = null): \BlackCat\Crypto\Keyring\KeyMaterial
    {
        return $this->keyRegistry->deriveAeadKey($slot, $forceKeyId);
    }

    /**
     * @return list<\BlackCat\Crypto\Keyring\KeyMaterial>
     */
    public function allKeyMaterial(string $slot): array
    {
        return $this->keyRegistry->all($slot);
    }

    private static function buildAead(string $driver, KeyRegistry $registry, ?LoggerInterface $logger): AeadCipherInterface
    {
        return match ($driver) {
            'hybrid' => new \BlackCat\Crypto\AEAD\HybridKyberAesCipher($logger),
            default => new XChaCha20Cipher($logger),
        };
    }

    private function maybeScheduleRotation(Envelope $envelope): void
    {
        if ($this->rotationPolicies === null || $this->wrapQueue === null) {
            return;
        }
        if ($this->rotationPolicies->shouldRotate($envelope)) {
            $this->wrapQueue->enqueue(new WrapJob($envelope->context, $envelope->encode()));
        }
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function recordIntent(string $intent, array $payload): void
    {
        $collector = $this->intents ?? IntentCollector::global();
        if ($collector === null) {
            return;
        }

        try {
            $collector->record($intent, $payload);
        } catch (\Throwable) {
            // Telemetry hooks must never break crypto flows.
        }
    }
}
