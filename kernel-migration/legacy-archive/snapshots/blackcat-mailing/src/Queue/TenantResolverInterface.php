<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Queue;

interface TenantResolverInterface
{
    public function resolveTenantId(): int;
}

