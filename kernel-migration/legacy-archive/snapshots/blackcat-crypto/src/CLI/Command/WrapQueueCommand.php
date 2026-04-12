<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\CryptoManager;
use BlackCat\Crypto\Queue\RotationCoordinator;
use BlackCat\Crypto\Queue\WrapQueueInterface;
use BlackCat\Crypto\Support\Envelope;
use Psr\Log\LoggerInterface;

final class WrapQueueCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string
    {
        return 'wrap:queue';
    }

    public function description(): string
    {
        return 'Inspect or process the rotation queue (status|run).';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$action, $options] = $this->extractActionAndOptions($args);
        $config = CryptoConfig::fromEnv();
        $factory = $config->wrapQueueFactory();
        if (!$factory) {
            fwrite(STDERR, "No wrap queue configured. Set BLACKCAT_CRYPTO_WRAP_QUEUE (e.g. file:///tmp/wrap.queue).\n");
            return 1;
        }
        /** @var WrapQueueInterface $queue */
        $queue = $factory();
        return $action === 'run'
            ? $this->runProcessor($config, $queue, $options)
            : $this->printStatus($queue, $options);
    }

    /** @param array<string,mixed> $options */
    private function printStatus(WrapQueueInterface $queue, array $options): int
    {
        $limit = isset($options['limit']) ? max(1, (int)$options['limit']) : 25;
        $metrics = \BlackCat\Crypto\Telemetry\TelemetryExporter::queueMetrics($queue, $limit);
        $status = [
            'backlog' => $metrics['backlog'],
            'sampled' => $metrics['sampled'],
            'oldestAgeSeconds' => $metrics['oldest_age_seconds'],
            'contexts' => $metrics['sample_contexts'],
            'failed' => $metrics['failed'],
            'failedContexts' => $metrics['failed_contexts'],
        ];
        if (!empty($metrics['last_errors'])) {
            $status['lastErrors'] = $metrics['last_errors'];
        }
        echo json_encode($status, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return 0;
    }

    /** @param array<string,mixed> $options */
    private function runProcessor(CryptoConfig $config, WrapQueueInterface $queue, array $options): int
    {
        $limit = isset($options['limit']) ? max(1, (int)$options['limit']) : 10;
        $dumpDir = $options['dump-dir'] ?? null;
        try {
            $persist = $this->buildPersistCallback($dumpDir);
        } catch (\RuntimeException $e) {
            fwrite(STDERR, $e->getMessage() . PHP_EOL);
            return 1;
        }
        try {
            $crypto = CryptoManager::boot($config, $this->logger)->withWrapQueue($queue);
        } catch (\Throwable $e) {
            fwrite(STDERR, "Unable to boot CryptoManager: {$e->getMessage()}\n");
            return 1;
        }
        $coordinator = new RotationCoordinator($crypto, $queue, $persist, $this->logger);
        $processed = $coordinator->process($limit);
        echo "Processed {$processed} job(s).\n";
        return 0;
    }

    private function buildPersistCallback(?string $dumpDir): callable
    {
        if ($dumpDir === null) {
            return static function (string $context, Envelope $envelope): void {
                echo json_encode([
                    'context' => $context,
                    'envelope' => $envelope->encode(),
                ], JSON_UNESCAPED_SLASHES) . PHP_EOL;
            };
        }
        if (!is_dir($dumpDir) && !@mkdir($dumpDir, 0770, true) && !is_dir($dumpDir)) {
            throw new \RuntimeException('Unable to create dump directory: ' . $dumpDir);
        }
        return static function (string $context, Envelope $envelope) use ($dumpDir): void {
            $safe = preg_replace('~[^A-Za-z0-9_\-]+~', '_', $context) ?: 'context';
            $file = rtrim($dumpDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $safe . '_' . dechex((int)(microtime(true) * 1000000)) . '.json';
            file_put_contents($file, $envelope->encode());
        };
    }

    /**
     * @param array<int,string> $args
     * @return array{0:string,1:array<string,mixed>}
     */
    private function extractActionAndOptions(array $args): array
    {
        $action = 'status';
        if ($args !== [] && !str_starts_with($args[0], '--')) {
            $actionCandidate = strtolower($args[0]);
            if (in_array($actionCandidate, ['status', 'run'], true)) {
                $action = $actionCandidate;
                array_shift($args);
            }
        }
        $options = $this->parseOptions($args);
        return [$action, $options];
    }

    /**
     * @param array<int,string> $args
     * @return array<string,mixed>
     */
    private function parseOptions(array $args): array
    {
        $options = [];
        $count = count($args);
        for ($i = 0; $i < $count; $i++) {
            $arg = $args[$i];
            if (!str_starts_with($arg, '--')) {
                continue;
            }
            $eq = strpos($arg, '=');
            if ($eq !== false) {
                $key = substr($arg, 2, $eq - 2);
                $options[$key] = substr($arg, $eq + 1);
                continue;
            }
            $key = substr($arg, 2);
            $next = $args[$i + 1] ?? null;
            if ($next !== null && !str_starts_with($next, '--')) {
                $options[$key] = $next;
                $i++;
            } else {
                $options[$key] = true;
            }
        }
        return $options;
    }
}
