<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Kms\KmsRouter;
use BlackCat\Crypto\Watchdog\KmsWatchdog;
use Psr\Log\LoggerInterface;

final class KmsWatchdogCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string
    {
        return 'kms:watchdog';
    }

    public function description(): string
    {
        return 'Monitor KMS health and suspend unhealthy clients automatically.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $interval = $this->parseIntOption($args, '--interval', 30);
        $iterations = $this->parseIntOption($args, '--iterations', 0);
        $suspendTtl = (int)(getenv('BLACKCAT_CRYPTO_KMS_SUSPEND_TTL') ?: 180);

        $config = CryptoConfig::fromEnv();
        $router = new KmsRouter($config->kmsConfig(), $this->logger);
        $watchdog = new KmsWatchdog($router, $this->logger, [
            'suspend_ttl' => $suspendTtl,
        ]);

        $count = 0;
        do {
            $health = $router->health();
            $watchdog->evaluate($health);
            $count++;
            if ($iterations > 0 && $count >= $iterations) {
                break;
            }
            sleep(max(1, $interval));
        } while (true);

        return 0;
    }

    /** @param list<string> $args */
    private function parseIntOption(array $args, string $name, int $default): int
    {
        foreach ($args as $index => $arg) {
            if (str_starts_with($arg, "{$name}=")) {
                return (int)substr($arg, strlen($name) + 1);
            }
            if ($arg === $name && isset($args[$index + 1])) {
                return (int)$args[$index + 1];
            }
        }
        return $default;
    }
}
