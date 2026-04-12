<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Bridge\DatabaseCryptoHooks;
use BlackCat\Crypto\Telemetry\IntentCollector;
use BlackCat\Crypto\Kms\KmsRouter;
use BlackCat\Crypto\Telemetry\TelemetryExporter;
use Psr\Log\NullLogger;

/**
 * Emit DB crypto hook telemetry snapshot for db-crypto CI (JSON/Prom/Otel).
 */
final class DbSnapshotCommand implements CommandInterface
{
    public function name(): string
    {
        return 'db:snapshot';
    }

    public function description(): string
    {
        return 'Emit DB crypto hook telemetry snapshot (json|prom|otel) for db-crypto CI.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $format = $this->parseArg($args, ['--format'], default: 'json');
        $output = $this->parseArg($args, ['--output', '-o'], default: getenv('DB_CRYPTO_SNAPSHOT_PATH') ?: null);

        if (!in_array($format, ['json', 'prom', 'otel'], true)) {
            fwrite(STDERR, "Unsupported format '{$format}'. Use json|prom|otel.\n");
            return 1;
        }

        $config = CryptoConfig::fromEnv();
        $router = new KmsRouter($config->kmsConfig(), new NullLogger());
        $kmsHealth = $router->health();

        $queueFactory = $config->wrapQueueFactory();
        $queue = $queueFactory ? $queueFactory() : null;

        $collector = IntentCollector::global() ?? new IntentCollector();
        $hooks = new DatabaseCryptoHooks($collector);

        $snapshot = $hooks->telemetrySnapshot($kmsHealth, $queue, $collector);

        $payload = match ($format) {
            'prom' => TelemetryExporter::asPrometheus($snapshot),
            'otel' => json_encode(TelemetryExporter::asOpenTelemetry($snapshot), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
            default => json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
        };

        if ($payload === false) {
            fwrite(STDERR, "Failed to encode snapshot.\n");
            return 1;
        }

        if ($output) {
            file_put_contents($output, $payload . PHP_EOL);
        } else {
            echo $payload . PHP_EOL;
        }

        return 0;
    }

    /**
     * @param list<string> $args
     * @param list<string> $keys
     */
    private function parseArg(array $args, array $keys, ?string $default = null): ?string
    {
        foreach ($args as $idx => $arg) {
            foreach ($keys as $key) {
                $prefix = $key . '=';
                if (str_starts_with($arg, $prefix)) {
                    return substr($arg, strlen($prefix));
                }
                if ($arg === $key && isset($args[$idx + 1])) {
                    return $args[$idx + 1];
                }
            }
        }

        // Allow first positional non-option to set value
        foreach ($args as $arg) {
            if (!str_starts_with($arg, '-')) {
                return $arg;
            }
        }

        return $default;
    }
}
