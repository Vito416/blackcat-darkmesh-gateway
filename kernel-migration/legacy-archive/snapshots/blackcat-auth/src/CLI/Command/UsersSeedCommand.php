<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;

final class UsersSeedCommand implements CommandInterface
{
    public function name(): string { return 'users:seed'; }
    public function description(): string { return 'Create or update seed users defined in config.'; }

    /** @param list<string> $args */
    public function run(array $args, AuthRuntime $runtime): int
    {
        $force = in_array('--force', $args, true);
        $runtime->ensureUserStoreSchema();
        $created = $runtime->seedUsers($force);
        $count = count($created);
        echo sprintf("Seeded %d user(s).\n", $count);
        if ($count > 0) {
            echo implode("\n", array_map(static fn(string $id) => " - {$id}", $created)) . "\n";
        }
        return 0;
    }
}
