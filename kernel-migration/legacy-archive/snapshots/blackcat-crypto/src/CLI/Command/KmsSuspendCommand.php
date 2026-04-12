<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Config\Runtime\ConfigRepository;
use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Kms\KmsRouter;
use Psr\Log\LoggerInterface;

final class KmsSuspendCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string
    {
        return 'kms:suspend';
    }

    public function description(): string
    {
        return 'Temporarily suspend a KMS client for a number of seconds.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $configPath = null;
        $filtered = [];
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--config=')) {
                $configPath = substr($arg, 9);
                continue;
            }
            $filtered[] = $arg;
        }

        $args = $filtered;
        $clientId = $args[0] ?? null;
        $ttl = isset($args[1]) ? (int)$args[1] : 300;
        if ($clientId === null || $ttl <= 0) {
            fwrite(STDERR, "Usage: kms:suspend [--config=path] <client-id> [ttl-seconds]\n");
            return 1;
        }

        $cryptoCfg = $configPath !== null && $configPath !== ''
            ? CryptoConfig::fromRuntimeConfig(ConfigRepository::fromJsonFile($configPath))
            : CryptoConfig::fromRuntimeConfig();

        $cfg = $cryptoCfg->kmsConfig();
        if ($cfg === []) {
            fwrite(STDERR, "No KMS endpoints configured (set runtime config crypto.kms_endpoints).\n");
            return 1;
        }

        $router = new KmsRouter($cfg, $this->logger);
        $router->suspend($clientId, $ttl);
        echo "Suspended {$clientId} for {$ttl}s\n";
        return 0;
    }
}
