<?php
declare(strict_types=1);

namespace BlackCat\Installer\Modules;

final class Module
{
    /**
     * @param array<string,mixed> $meta
     */
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly array $meta
    ) {}

    /**
     * @return list<string>
     */
    public function composerPackages(): array
    {
        return array_values($this->meta['composer'] ?? []);
    }

    /**
     * @return list<string>
     */
    public function npmPackages(): array
    {
        return array_values($this->meta['npm'] ?? []);
    }

    /**
     * @return list<string>
     */
    public function dockerCommands(): array
    {
        return array_values($this->meta['docker'] ?? []);
    }

    /**
     * @return list<string>
     */
    public function bootstrapCommands(): array
    {
        return array_values($this->meta['bootstrap'] ?? []);
    }

    /**
     * @return array<string,string>
     */
    public function env(): array
    {
        $env = $this->meta['env'] ?? [];
        return is_array($env) ? $env : [];
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'meta' => $this->meta,
        ];
    }
}
