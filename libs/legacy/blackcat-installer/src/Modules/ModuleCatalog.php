<?php
declare(strict_types=1);

namespace BlackCat\Installer\Modules;

final class ModuleCatalog
{
    /** @var Module[] */
    private array $modules = [];

    public function __construct(string $file)
    {
        if (!is_file($file)) {
            throw new \InvalidArgumentException("Module catalog not found: {$file}");
        }

        $contents = file_get_contents($file);
        $decoded = json_decode($contents, true);
        if (!is_array($decoded)) {
            throw new \RuntimeException('Module catalog must be JSON array');
        }

        foreach ($decoded as $item) {
            if (!is_array($item)) {
                continue;
            }
            $this->modules[] = new Module(
                id: (string) ($item['id'] ?? ''),
                name: (string) ($item['name'] ?? ''),
                meta: $item
            );
        }
    }

    /**
     * @return Module[]
     */
    public function all(): array
    {
        return $this->modules;
    }

    /**
     * @param list<string> $ids
     * @return Module[]
     */
    public function filter(array $ids): array
    {
        $found = [];
        foreach ($this->modules as $module) {
            if (in_array($module->id, $ids, true)) {
                $found[] = $module;
            }
        }

        return $found;
    }
}
