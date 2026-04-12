<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;

final class UsersListCommand implements CommandInterface
{
    public function name(): string { return 'users:list'; }
    public function description(): string { return 'List users available in the configured store.'; }

    public function run(array $args, AuthRuntime $runtime): int
    {
        $limit = 20;
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--limit=')) {
                $limit = max(1, (int)substr($arg, 8));
            }
        }
        $rows = $runtime->listUsers($limit);
        foreach ($rows as $user) {
            $roles = $user['roles'] ?? [];
            $rolesStr = $roles ? implode(',', $roles) : '-';

            $principal = $user['email'] ?? ($user['email_hash'] ?? '-');

            $status = $user['status'] ?? null;
            if ($status === null) {
                $isActive = $user['is_active'] ?? null;
                $isLocked = $user['is_locked'] ?? null;
                if ($isActive !== null || $isLocked !== null) {
                    $status = ($isActive ? 'active' : 'inactive') . ($isLocked ? ',locked' : '');
                }
            }

            echo sprintf("%s\t%s\t%s\t%s\n", $user['id'] ?? '-', $principal, $rolesStr, $status ?? 'unknown');
        }
        return 0;
    }
}
