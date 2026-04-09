<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;
use BlackCat\Auth\Rbac\RoleRegistry;

final class RbacListCommand implements CommandInterface
{
    public function name(): string { return 'rbac:list'; }
    public function description(): string { return 'List configured roles and permissions.'; }

    /** @param list<string> $args */
    public function run(array $args, AuthRuntime $runtime): int
    {
        unset($args);
        $config = $runtime->authConfig();
        $registry = RoleRegistry::fromArray($config->roles());
        foreach ($config->roles() as $role => $_) {
            $perms = $registry->permissions((string)$role);
            echo sprintf("%s: %s\n", $role, $perms ? implode(', ', $perms) : '-');
        }
        return 0;
    }
}
