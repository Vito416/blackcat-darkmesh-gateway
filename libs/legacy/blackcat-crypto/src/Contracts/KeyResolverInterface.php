<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Contracts;

use BlackCat\Crypto\Keyring\KeySlot;
use BlackCat\Crypto\Keyring\KeyMaterial;

interface KeyResolverInterface
{
    public function resolve(KeySlot $slot, ?string $forceKeyId = null): KeyMaterial;

    /** @return list<KeyMaterial> */
    public function kmsBindings(KeySlot $slot): array;

    /** @return list<KeyMaterial> */
    public function all(KeySlot $slot): array;
}
