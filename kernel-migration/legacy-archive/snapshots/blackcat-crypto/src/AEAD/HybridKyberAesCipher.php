<?php
declare(strict_types=1);

namespace BlackCat\Crypto\AEAD;

use BlackCat\Crypto\Keyring\KeyMaterial;
use BlackCat\Crypto\Support\Payload;
use Psr\Log\LoggerInterface;

/**
 * Placeholder hybrid cipher combining random Kyber-like key encapsulation with AES-GCM-SIV fallback.
 * Acts as a post-quantum-ready hook; production deployments should replace it with a real implementation.
 */
final class HybridKyberAesCipher implements AeadCipherInterface
{
    public function __construct(private readonly ?LoggerInterface $logger = null) {}

    public function encrypt(string $plaintext, string $aad, KeyMaterial $key): Payload
    {
        $nonce = random_bytes(SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES);
        $ephemeral = random_bytes(32); // kyber-like shared secret stub
        $derived = hash_hkdf('sha3-256', $key->bytes . $ephemeral, 32, $aad);
        $cipher = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt($plaintext, $aad . $ephemeral, $nonce, $derived);
        return new Payload($ephemeral . $cipher, $nonce, $key->id, ['mode' => 'hybrid']);
    }

    public function decrypt(Payload $payload, string $aad, KeyMaterial $key): string
    {
        $ephemeral = substr($payload->ciphertext, 0, 32);
        $ciphertext = substr($payload->ciphertext, 32);
        $derived = hash_hkdf('sha3-256', $key->bytes . $ephemeral, 32, $aad);
        $plain = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt($ciphertext, $aad . $ephemeral, $payload->nonce, $derived);
        if ($plain === false) {
            $this->logger?->debug('Hybrid decrypt failed', ['keyId' => $key->id]);
            throw new \RuntimeException('Hybrid decrypt failed');
        }
        return $plain;
    }
}
