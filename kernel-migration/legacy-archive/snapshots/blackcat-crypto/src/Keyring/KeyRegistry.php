<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Keyring;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Contracts\KeyResolverInterface;
use Psr\Log\LoggerInterface;

final class KeyRegistry
{
    /** @var array<string,KeySlot> */
    private array $slots = [];
    private KeyResolverInterface $resolver;

    public function __construct(KeyResolverInterface $resolver)
    {
        $this->resolver = $resolver;
    }

    public static function fromConfig(CryptoConfig $config, ?LoggerInterface $logger = null): self
    {
        $resolver = new MultiSourceKeyResolver($config->keySources(), $logger);
        $registry = new self($resolver);
        foreach ($config->slots() as $name => $definition) {
            $registry->registerSlot(KeySlot::fromArray($name, $definition));
        }
        return $registry;
    }

    public function registerSlot(KeySlot $slot): void
    {
        $this->slots[$slot->name()] = $slot;
    }

    public function deriveAeadKey(string $slot, ?string $forceKeyId = null): KeyMaterial
    {
        $slotDef = $this->slots[$slot] ?? KeySlot::default($slot);
        return $this->resolver->resolve($slotDef, $forceKeyId);
    }

    /** @return list<KeyMaterial> */
    public function kmsBindings(string $slot): array
    {
        $slotDef = $this->slots[$slot] ?? KeySlot::default($slot);
        return $this->resolver->kmsBindings($slotDef);
    }

    /**
     * @return list<KeyMaterial>
     */
    public function all(string $slot): array
    {
        $slotDef = $this->slots[$slot] ?? KeySlot::default($slot);
        return $this->resolver->all($slotDef);
    }
}
