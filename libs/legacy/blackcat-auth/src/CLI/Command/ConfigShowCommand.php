<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;

final class ConfigShowCommand implements CommandInterface
{
    public function name(): string { return 'config:show'; }
    public function description(): string { return 'Show resolved configuration summary (issuer, TTLs, telemetry).'; }

    /** @param list<string> $args */
    public function run(array $args, AuthRuntime $runtime): int
    {
        $config = $runtime->authConfig();
        $summary = [
            'issuer' => $config->issuer(),
            'audience' => $config->audience(),
            'access_ttl' => $config->accessTtl(),
            'refresh_ttl' => $config->refreshTtl(),
            'session_ttl' => $config->sessionTtl(),
            'magic_link_ttl' => $config->magicLinkTtl(),
            'public_base_url' => $config->publicBaseUrl(),
            'telemetry_file' => $runtime->config()->telemetryFile(),
            'roles' => array_keys($config->roles()),
            'clients' => array_keys($config->clients()),
        ];
        echo json_encode($summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return 0;
    }
}
