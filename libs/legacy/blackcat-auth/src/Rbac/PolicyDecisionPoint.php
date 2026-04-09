<?php
declare(strict_types=1);

namespace BlackCat\Auth\Rbac;

use Psr\Log\LoggerInterface;

final class PolicyDecisionPoint
{
    public function __construct(private readonly RoleRegistry $roles, private readonly LoggerInterface $logger) {}

    /** @param array<string,mixed> $claims */
    public function allow(string $requiredRole, array $claims): bool
    {
        $userRoles = $claims['roles'] ?? [];
        foreach ($userRoles as $role) {
            $permissions = $this->roles->permissions($role);
            if (in_array($requiredRole, $permissions, true) || in_array($requiredRole, $userRoles, true)) {
                return true;
            }
        }
        $this->logger->warning('rbac.denied', ['required' => $requiredRole, 'userRoles' => $userRoles]);
        return false;
    }
}
