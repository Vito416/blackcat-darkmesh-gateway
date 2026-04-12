<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;

final class TokenIssueCommand implements CommandInterface
{
    public function name(): string { return 'token:issue'; }
    public function description(): string { return 'Issue a token pair via configured identity provider.'; }

    /** @param list<string> $args */
    public function run(array $args, AuthRuntime $runtime): int
    {
        $user = null;
        $password = null;
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--user=')) {
                $user = substr($arg, 7);
            } elseif (str_starts_with($arg, '--password=')) {
                $password = substr($arg, 11);
            }
        }
        if (!$user) {
            fwrite(STDERR, "Usage: token:issue --user=<email> [--password=value]\n");
            return 1;
        }
        $password ??= 'secret';
        try {
            $tokens = $runtime->auth()->issueTokens($user, $password);
        } catch (\Throwable $e) {
            fwrite(STDERR, $e->getMessage() . PHP_EOL);
            return 1;
        }
        echo json_encode([
            'access_token' => $tokens->accessToken,
            'refresh_token' => $tokens->refreshToken,
            'expires_at' => $tokens->expiresAt,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return 0;
    }
}
