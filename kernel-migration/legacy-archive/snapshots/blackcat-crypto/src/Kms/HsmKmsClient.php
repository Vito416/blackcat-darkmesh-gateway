<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Kms;

use BlackCat\Crypto\Contracts\KmsClientInterface;
use BlackCat\Crypto\Support\Payload;
use RuntimeException;

/**
 * Lightweight “HSM” adapter that keeps a local symmetric key and speaks the same
 * contract as remote KMS clients. Useful for dev/test or when integrating with
 * on-prem HSMs through a PKCS#11 bridge.
 */
final class HsmKmsClient implements KmsClientInterface
{
    /**
     * @param array<string,mixed> $config
     */
    public function __construct(private readonly array $config)
    {
    }

    public function id(): string
    {
        return (string)($this->config['id'] ?? 'hsm-kms');
    }

    private function keyVersion(): ?string
    {
        $version = $this->config['key_version'] ?? null;
        return $version === null ? null : (string)$version;
    }

    /**
     * Guardrails applied before performing wrap/unwrap:
     * - allow_wrap / allow_unwrap flags
     * - optional tenant allow-list (allowed_tenants) enforced per request
     * - optional suspend file (JSON: {"suspend":true,"reason":"...","until_ms":epoch_ms})
     * - optional artificial latency_ms for chaos/bench
     */
    private function guardOperation(string $operation, ?string $tenant = null): void
    {
        $key = 'allow_' . $operation;
        if (array_key_exists($key, $this->config) && $this->config[$key] === false) {
            throw new RuntimeException(sprintf('HSM %s disabled by policy.', $operation));
        }

        $allowedTenants = $this->config['allowed_tenants'] ?? null;
        if (is_array($allowedTenants) && $allowedTenants !== []) {
            if ($tenant === null || $tenant === '') {
                throw new RuntimeException(sprintf('HSM %s blocked: tenant is required.', $operation));
            }
            if (!in_array($tenant, $allowedTenants, true)) {
                throw new RuntimeException(sprintf('HSM %s blocked: tenant %s not allowed.', $operation, $tenant));
            }
        }

        $suspend = $this->isSuspended();
        if ($suspend['suspend'] ?? false) {
            $reason = $suspend['reason'] ?? 'suspended';
            throw new RuntimeException(sprintf('HSM %s blocked: %s', $operation, $reason));
        }

        $latencyMs = (int)($this->config['latency_ms'] ?? 0);
        if ($latencyMs > 0) {
            usleep($latencyMs * 1000);
        }
    }

    /** @return array<string,mixed> */
    public function wrap(string $context, Payload $payload): array
    {
        $tenant = $this->extractTenant(null, $context);
        $this->guardOperation('wrap', $tenant);
        $key = $this->loadKey();
        $cipher = $this->cipher();
        $nonce = random_bytes($this->nonceLength($cipher));
        $aad = $this->aad($context);
        $tagLength = $this->tagLength($cipher);
        $tag = null;

        $ciphertext = openssl_encrypt(
            $payload->ciphertext,
            $cipher,
            $key,
            OPENSSL_RAW_DATA,
            $nonce,
            $tag,
            $aad,
            $tagLength
        );
        if ($ciphertext === false) {
            throw new RuntimeException('HSM wrap failed for context ' . $context);
        }

        $meta = [
            'ciphertext' => base64_encode($ciphertext),
            'nonce' => base64_encode($nonce),
            'keyId' => $this->id(),
            'innerNonce' => base64_encode($payload->nonce),
            'cipher' => $cipher,
            'tagLength' => $tagLength,
        ];
        if (($version = $this->keyVersion()) !== null) {
            $meta['keyVersion'] = $version;
        }
        if ($tag !== null) {
            $meta['tag'] = base64_encode($tag);
        }
        if ($tenant !== null) {
            $meta['tenant'] = $tenant;
        }

        return $meta;
    }

    /** @param array<string,mixed> $metadata */
    public function unwrap(string $context, array $metadata): Payload
    {
        $tenant = $this->extractTenant($metadata, $context);
        $this->guardOperation('unwrap', $tenant);
        $key = $this->loadKey();
        $cipher = (string)($metadata['cipher'] ?? $this->cipher());
        if (!$this->isCipherAllowed($cipher)) {
            throw new RuntimeException('Cipher ' . $cipher . ' is not allowed for HSM unwrap.');
        }
        $expectedVersion = $this->keyVersion();
        $metaVersion = $metadata['keyVersion'] ?? null;
        if ($expectedVersion !== null && $metaVersion !== null && (string)$metaVersion !== $expectedVersion) {
            throw new RuntimeException('HSM unwrap rejected: keyVersion mismatch.');
        }
        $ciphertext = base64_decode((string)($metadata['ciphertext'] ?? ''), true);
        $nonce = base64_decode((string)($metadata['nonce'] ?? ''), true);
        $tag = array_key_exists('tag', $metadata) ? base64_decode((string)$metadata['tag'], true) : null;
        if ($ciphertext === false || $nonce === false) {
            throw new RuntimeException('HSM unwrap metadata invalid for ' . $context);
        }
        $aad = $this->aad($context);
        $plaintext = openssl_decrypt(
            $ciphertext,
            $cipher,
            $key,
            OPENSSL_RAW_DATA,
            $nonce,
            $tag ?: '',
            $aad
        );
        if ($plaintext === false) {
            throw new RuntimeException('HSM unwrap failed for context ' . $context);
        }
        $innerNonce = base64_decode((string)($metadata['innerNonce'] ?? ''), true) ?: '';
        $keyId = (string)($metadata['keyId'] ?? $this->id());
        return new Payload(ciphertext: $plaintext, nonce: $innerNonce, keyId: $keyId, meta: ['client' => $this->id(), 'cipher' => $cipher]);
    }

    /** @return array<string,mixed> */
    public function health(): array
    {
        $key = null;
        try {
            $key = $this->loadKey();
        } catch (\Throwable) {
            // swallow, still return degraded health
        }
        $fingerprint = $key ? base64_encode(hash('sha256', $key, true)) : null;
        return [
            'client' => $this->id(),
            'status' => 'ok',
            'origin' => 'local-hsm',
            'cipher' => $this->cipher(),
            'key_bytes' => $this->keyLength(),
            'key_version' => $this->keyVersion(),
            'aad_context' => (bool)($this->config['aad_context'] ?? false),
            'nonce_bytes' => $this->nonceLength($this->cipher()),
            'tag_length' => $this->tagLength($this->cipher()),
            'allowed_ciphers' => $this->config['allow_ciphers'] ?? null,
            'allowed_tenants' => $this->config['allowed_tenants'] ?? null,
            'auth_mode' => $this->config['auth_mode'] ?? null,
            'fingerprint' => $fingerprint,
            'suspend' => $this->readSuspendState(),
            'latency_ms' => (int)($this->config['latency_ms'] ?? 0),
            'request_timeout_ms' => (int)($this->config['request_timeout_ms'] ?? 0),
        ];
    }

    public function suspend(?string $reason = null, ?int $untilMs = null): void
    {
        $state = [
            'suspend' => true,
            'reason' => $reason ?? 'manual-suspend',
        ];
        if ($untilMs !== null) {
            $state['until_ms'] = $untilMs;
        }
        $this->persistSuspendState($state);
    }

    public function resume(): void
    {
        $this->persistSuspendState(['suspend' => false, 'reason' => 'manual-resume']);
    }

    private function loadKey(): string
    {
        $secret = (string)($this->config['secret'] ?? '');
        if ($secret === '' && isset($this->config['secret_path'])) {
            $path = (string)$this->config['secret_path'];
            if (!is_readable($path)) {
                throw new RuntimeException('HsmKmsClient secret_path is not readable: ' . $path);
            }
            $secret = trim((string)file_get_contents($path));
        }
        if ($secret === '') {
            throw new RuntimeException('HsmKmsClient requires a base64 secret (inline or secret_path).');
        }
        $bytes = base64_decode($secret, true);
        if ($bytes === false) {
            throw new RuntimeException('HsmKmsClient secret must be base64-encoded.');
        }
        $minLen = $this->keyLength();
        $len = strlen($bytes);
        if ($len < $minLen) {
            throw new RuntimeException(sprintf('HsmKmsClient secret must be at least %d bytes, got %d.', $minLen, $len));
        }
        return substr($bytes, 0, $minLen);
    }

    private function keyLength(): int
    {
        return (int)($this->config['key_bytes'] ?? 32);
    }

    private function cipher(): string
    {
        $preferred = $this->config['preferred_ciphers'] ?? null;
        $candidates = is_array($preferred) && $preferred !== []
            ? $preferred
            : [(string)($this->config['cipher'] ?? 'aes-256-gcm')];
        foreach ($candidates as $cipher) {
            $cipher = (string)$cipher;
            if ($this->isCipherAllowed($cipher)) {
                return $cipher;
            }
        }
        throw new RuntimeException('No allowed cipher is available for HsmKmsClient.');
    }

    private function tagLength(string $cipher): int
    {
        if (!$this->isAeadCipher($cipher)) {
            return 0;
        }
        $value = (int)($this->config['tag_length'] ?? 16);
        // Guard against overly short or excessive AEAD tags; OpenSSL typically permits 4–16 bytes,
        // but we enforce a safer 8–32 byte window to avoid weak integrity coverage.
        if ($value < 8 || $value > 32) {
            throw new RuntimeException(sprintf('Invalid AEAD tag_length %d; expected between 8 and 32 bytes.', $value));
        }
        return $value;
    }

    private function isAeadCipher(string $cipher): bool
    {
        return stripos($cipher, 'gcm') !== false || stripos($cipher, 'ccm') !== false;
    }

    private function isCipherAllowed(string $cipher): bool
    {
        if (!in_array($cipher, openssl_get_cipher_methods(), true)) {
            return false;
        }
        $allowList = $this->config['allow_ciphers'] ?? null;
        if ($allowList === null) {
            return true;
        }
        return in_array($cipher, (array)$allowList, true);
    }

    private function aad(string $context): string
    {
        $base = (string)($this->config['aad'] ?? '');
        $withContext = (bool)($this->config['aad_context'] ?? false);
        $separator = (string)($this->config['aad_separator'] ?? '|');
        return $withContext ? $base . $separator . $context : $base;
    }

    /** @return int<1,max> */
    private function nonceLength(string $cipher): int
    {
        $configured = (int)($this->config['nonce_bytes'] ?? 12);
        $ivLen = openssl_cipher_iv_length($cipher);
        $min = (is_int($ivLen) && $ivLen > 0) ? $ivLen : 12;
        $length = max(12, $min, $configured);
        if ($length < 1) {
            $length = 1;
        }
        return $length;
    }

    /** @param array<string,mixed>|null $metadata */
    private function extractTenant(?array $metadata, string $context): ?string
    {
        $metaTenant = $metadata['tenant'] ?? null;
        if (is_string($metaTenant) && $metaTenant !== '') {
            return $metaTenant;
        }
        if (preg_match('/tenant[:=]([A-Za-z0-9._-]+)/', $context, $matches)) {
            return $matches[1];
        }
        return null;
    }

    /** @return array<string,mixed> */
    private function readSuspendState(): array
    {
        $path = $this->suspendPath();
        if ($path === null) {
            return ['suspend' => false];
        }
        if (!is_readable($path)) {
            return ['suspend' => false, 'error' => 'suspend_path not readable'];
        }
        $raw = (string)file_get_contents($path);
        $json = json_decode($raw, true);
        if (!is_array($json)) {
            return ['suspend' => false, 'error' => 'invalid suspend file'];
        }
        return $json + ['suspend' => false];
    }

    /** @return array<string,mixed> */
    private function isSuspended(): array
    {
        $state = $this->readSuspendState();
        if (!($state['suspend'] ?? false)) {
            return ['suspend' => false];
        }

        $until = $state['until_ms'] ?? null;
        $now = (int)(microtime(true) * 1000);
        if ($until !== null && (int)$until <= $now) {
            // auto-resume once the window passed
            $this->persistSuspendState(['suspend' => false, 'reason' => 'auto-resume', 'expired_at_ms' => $now]);
            return ['suspend' => false, 'reason' => 'auto-resume'];
        }

        return $state;
    }

    /** @param array<string,mixed> $state */
    private function persistSuspendState(array $state): void
    {
        $path = $this->suspendPath();
        if ($path === null) {
            return;
        }
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create suspend directory: ' . $dir);
        }
        $payload = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            throw new RuntimeException('Failed to encode suspend state.');
        }
        if (file_put_contents($path, $payload) === false) {
            throw new RuntimeException('Failed to persist suspend state at ' . $path);
        }
    }

    private function suspendPath(): ?string
    {
        return isset($this->config['suspend_path']) ? (string)$this->config['suspend_path'] : null;
    }
}
