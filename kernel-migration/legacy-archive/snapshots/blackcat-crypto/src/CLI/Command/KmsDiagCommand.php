<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Config\Runtime\ConfigRepository;
use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Kms\KmsRouter;
use Psr\Log\LoggerInterface;

final class KmsDiagCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string { return 'kms:diag'; }
    public function description(): string { return 'Print health information for configured KMS clients.'; }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $configPath = null;
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--config=')) {
                $configPath = substr($arg, 9);
            }
        }

        $config = $configPath !== null && $configPath !== ''
            ? CryptoConfig::fromRuntimeConfig(ConfigRepository::fromJsonFile($configPath))
            : CryptoConfig::fromRuntimeConfig();
        $kmsConfig = $config->kmsConfig();
        if ($kmsConfig === []) {
            fwrite(STDERR, "No KMS endpoints configured (set runtime config crypto.kms_endpoints).\n");
            return 1;
        }
        $router = new KmsRouter($kmsConfig, $this->logger);
        $health = $router->health();
        echo json_encode($health, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return 0;
    }
}
