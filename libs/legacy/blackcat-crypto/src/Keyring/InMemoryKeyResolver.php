<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Keyring;

use BlackCat\Crypto\Contracts\KeyResolverInterface;

final class InMemoryKeyResolver implements KeyResolverInterface
{
    /** @param array<string,list<KeyMaterial>> $keys */
    public function __construct(private array $keys)
    {
    }

    public function resolve(KeySlot $slot, ?string $forceKeyId = null): KeyMaterial
    {
        $list = $this->keys[$slot->name()] ?? null;
        if (!$list) {
            throw new \RuntimeException('Missing keys for slot ' . $slot->name());
        }
        if ($forceKeyId !== null) {
            foreach ($list as $mat) {
                if ($mat->id === $forceKeyId) {
                    return $mat;
                }
            }
        }
        return $list[count($list) - 1];
    }

    public function kmsBindings(KeySlot $slot): array
    {
        return [];
    }

    public function all(KeySlot $slot): array
    {
        return $this->keys[$slot->name()] ?? [];
    }
}
