<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Queue;

use BlackCat\Database\Packages\Tenants\Repository\TenantRepository;

final class SlugTenantResolver implements TenantResolverInterface
{
    private ?int $cached = null;

    public function __construct(
        private readonly TenantRepository $tenants,
        private readonly string $slug,
        private readonly string $name = 'Default tenant',
        private readonly bool $autoCreate = false,
    ) {}

    public function resolveTenantId(): int
    {
        if (is_int($this->cached) && $this->cached > 0) {
            return $this->cached;
        }

        $slug = trim($this->slug);
        if ($slug === '') {
            throw new \InvalidArgumentException('tenant_slug must not be empty');
        }

        $slugCi = strtolower($slug);
        $row = $this->tenants->getByUnique(['slug_ci' => $slugCi]);
        if (is_array($row) && isset($row['id'])) {
            $id = (int)$row['id'];
            if ($id > 0) {
                return $this->cached = $id;
            }
        }

        if (!$this->autoCreate) {
            throw new \RuntimeException('Tenant not found: ' . $slug);
        }

        $this->tenants->insert([
            'name' => trim($this->name) !== '' ? trim($this->name) : 'Default tenant',
            'slug' => $slug,
            'status' => 'active',
        ]);

        $row = $this->tenants->getByUnique(['slug_ci' => $slugCi]);
        if (is_array($row) && isset($row['id'])) {
            $id = (int)$row['id'];
            if ($id > 0) {
                return $this->cached = $id;
            }
        }

        throw new \RuntimeException('Unable to create default tenant');
    }
}
