<?php
declare(strict_types=1);

namespace BlackCat\Crypto\AEAD;

use BlackCat\Crypto\Keyring\KeyMaterial;
use BlackCat\Crypto\Support\Payload;
use Psr\Log\LoggerInterface;

final class XChaCha20Cipher implements AeadCipherInterface
{
    public function __construct(private readonly ?LoggerInterface $logger = null) {}

    public function encrypt(string $plaintext, string $aad, KeyMaterial $key): Payload
    {
        $nonce = random_bytes(SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES);
        $cipher = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt($plaintext, $aad, $nonce, $key->bytes);
        return new Payload($cipher, $nonce, $key->id, ['version' => 1]);
    }

    public function decrypt(Payload $payload, string $aad, KeyMaterial $key): string
    {
        $plain = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt($payload->ciphertext, $aad, $payload->nonce, $key->bytes);
        if ($plain === false) {
            $this->logger?->debug('Unable to decrypt payload', ['keyId' => $key->id]);
            throw new \RuntimeException('Unable to decrypt payload');
        }
        return $plain;
    }
}
