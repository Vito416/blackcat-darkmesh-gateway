<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Keyring;

final class KeySlot
{
    /**
     * @param array<string,mixed> $options
     */
    public function __construct(
        private readonly string $name,
        private readonly string $type,
        private readonly string $keyName,
        private readonly int $length,
        private readonly array $options = [],
    ) {}

    public static function default(string $name): self
    {
        return new self($name, 'aead', strtoupper(str_replace('.', '_', $name)), 32);
    }

    /** @param array<string,mixed> $data */
    public static function fromArray(string $name, array $data): self
    {
        return new self(
            $name,
            $data['type'] ?? 'aead',
            $data['key'] ?? strtoupper($name),
            (int)($data['length'] ?? 32),
            $data['options'] ?? []
        );
    }

    public function name(): string { return $this->name; }
    public function type(): string { return $this->type; }
    public function keyName(): string { return $this->keyName; }
    public function length(): int { return $this->length; }
    /** @return array<string,mixed> */
    public function options(): array { return $this->options; }
}
