<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Config\Runtime\ConfigRepository;
use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Kms\KmsRouter;
use Psr\Log\LoggerInterface;

final class KmsResumeCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string
    {
        return 'kms:resume';
    }

    public function description(): string
    {
        return 'Resume a suspended KMS client immediately.';
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
        if ($clientId === null) {
            fwrite(STDERR, "Usage: kms:resume [--config=path] <client-id>\n");
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
        $router->release($clientId);
        echo "Resumed {$clientId}\n";
        return 0;
    }
}
