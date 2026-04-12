<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;

final class UserHashPasswordCommand implements CommandInterface
{
    public function name(): string { return 'user:hash-password'; }
    public function description(): string { return 'Hash a password with the configured pepper provider (for seeding DB).'; }

    /** @param list<string> $args */
    public function run(array $args, AuthRuntime $runtime): int
    {
        $password = null;
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--password=')) {
                $password = substr($arg, 11);
            }
        }
        if ($password === null) {
            fwrite(STDERR, "Password: ");
            $password = trim((string)fgets(STDIN));
        }
        if ($password === '') {
            fwrite(STDERR, "Password cannot be empty.\n");
            return 1;
        }
        $hasher = $runtime->userStore()->hasher();
        if ($hasher === null) {
            fwrite(STDERR, "Hashing requires database user_store configuration.\n");
            return 2;
        }
        $hash = $hasher->hash($password);
        echo json_encode([
            'hash' => $hash,
            'pepper_version' => $hasher->currentPepperVersion(),
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return 0;
    }
}
