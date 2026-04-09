<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;

final class RbacCheckCommand implements CommandInterface
{
    public function name(): string { return 'rbac:check'; }
    public function description(): string { return 'Evaluate a role requirement against a JSON claims payload.'; }

    public function run(array $args, AuthRuntime $runtime): int
    {
        $role = null;
        $claimsJson = null;
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--role=')) {
                $role = substr($arg, 7);
            } elseif (str_starts_with($arg, '--claims=')) {
                $claimsJson = substr($arg, 9);
            }
        }
        if (!$role || !$claimsJson) {
            fwrite(STDERR, "Usage: rbac:check --role=<role> --claims='{\"roles\":[\"admin\"]}'\n");
            return 1;
        }
        $claims = json_decode($claimsJson, true);
        if (!is_array($claims)) {
            fwrite(STDERR, "Invalid claims JSON.\n");
            return 1;
        }
        try {
            $runtime->auth()->enforce($role, $claims);
            fwrite(STDOUT, "allow\n");
            return 0;
        } catch (\Throwable $e) {
            fwrite(STDOUT, "deny: " . $e->getMessage() . "\n");
            return 2;
        }
    }
}
