<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;

final class TokenClientCommand implements CommandInterface
{
    public function name(): string { return 'token:client'; }
    public function description(): string { return 'Issue a client-credentials token for a configured client.'; }

    /** @param list<string> $args */
    public function run(array $args, AuthRuntime $runtime): int
    {
        $clientId = null;
        $clientSecret = null;
        $scopes = [];
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--client=')) {
                $clientId = substr($arg, 9);
            } elseif (str_starts_with($arg, '--secret=')) {
                $clientSecret = substr($arg, 9);
            } elseif (str_starts_with($arg, '--scopes=')) {
                $scopes = array_filter(array_map('trim', explode(',', substr($arg, 9))));
            }
        }
        if (!$clientId || $clientSecret === null) {
            fwrite(STDERR, "Usage: token:client --client=<id> --secret=<secret> [--scopes=a,b]\n");
            return 1;
        }
        try {
            $pair = $runtime->auth()->clientCredentials($clientId, $clientSecret, $scopes);
        } catch (\Throwable $e) {
            fwrite(STDERR, "Error: {$e->getMessage()}\n");
            return 2;
        }
        echo json_encode([
            'access_token' => $pair->accessToken,
            'expires_at' => $pair->expiresAt,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return 0;
    }
}
