<?php
declare(strict_types=1);

namespace BlackCat\Crypto\AEAD;

use BlackCat\Crypto\Keyring\KeyMaterial;
use BlackCat\Crypto\Support\Payload;

interface AeadCipherInterface
{
    public function encrypt(string $plaintext, string $aad, KeyMaterial $key): Payload;
    public function decrypt(Payload $payload, string $aad, KeyMaterial $key): string;
}
