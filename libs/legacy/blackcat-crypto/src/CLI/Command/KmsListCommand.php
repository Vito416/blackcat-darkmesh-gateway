<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Config\Runtime\ConfigRepository;
use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Kms\KmsRouter;
use Psr\Log\LoggerInterface;

final class KmsListCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string
    {
        return 'kms:list';
    }

    public function description(): string
    {
        return 'List configured KMS clients, weights, contexts and suspension state.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $json = in_array('--json', $args, true);
        $configPath = null;
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--config=')) {
                $configPath = substr($arg, 9);
            }
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
        $clients = $router->describe();
        if ($json) {
            echo json_encode($clients, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
            return 0;
        }

        echo "KMS clients:\n";
        foreach ($clients as $entry) {
            $contexts = $entry['contexts'] === [] ? '*' : implode(',', $entry['contexts']);
            $suspended = $entry['suspendedUntil'] === null ? 'active' : ('suspended until ' . date('c', $entry['suspendedUntil']));
            echo sprintf(
                " - %s (type=%s, weight=%d, contexts=%s, %s)\n",
                $entry['id'],
                $entry['type'],
                $entry['weight'],
                $contexts,
                $suspended
            );
        }
        return 0;
    }
}
