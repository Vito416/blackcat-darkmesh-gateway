<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Queue;

final class FixedTenantResolver implements TenantResolverInterface
{
    public function __construct(private readonly int $tenantId) {}

    public function resolveTenantId(): int
    {
        if ($this->tenantId <= 0) {
            throw new \RuntimeException('tenant_id must be a positive integer');
        }
        return $this->tenantId;
    }
}

