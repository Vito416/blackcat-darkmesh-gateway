<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Kms\KmsRouter;
use BlackCat\Crypto\Telemetry\TelemetryExporter;
use Psr\Log\LoggerInterface;

final class MetricsExportCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string
    {
        return 'metrics:export';
    }

    public function description(): string
    {
        return 'Emit telemetry snapshot (JSON, Prometheus, or OTLP/JSON).';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$format, $options] = $this->parseFormat($args);
        $config = CryptoConfig::fromEnv();
        $router = new KmsRouter($config->kmsConfig(), $this->logger);
        $queueFactory = $config->wrapQueueFactory();
        $queue = $queueFactory ? $queueFactory() : null;
        $snapshot = TelemetryExporter::snapshot($router->health(), $queue);
        if ($format === 'prom') {
            echo TelemetryExporter::asPrometheus($snapshot);
        } elseif ($format === 'otel') {
            echo json_encode(
                TelemetryExporter::asOpenTelemetry($snapshot),
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
            ) . PHP_EOL;
        } else {
            echo json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        }
        return 0;
    }

    /**
     * @param array<int,string> $args
     * @return array{0:string,1:array<string,string>}
     */
    private function parseFormat(array $args): array
    {
        $format = 'json';
        $options = [];
        foreach ($args as $i => $arg) {
            if ($i === 0 && $arg !== '' && $arg[0] !== '-') {
                $format = strtolower($arg);
                continue;
            }
            if (str_starts_with($arg, '--format=')) {
                $format = strtolower(substr($arg, 9));
            } elseif ($arg === '--format' && isset($args[$i + 1])) {
                $format = strtolower($args[$i + 1]);
            }
        }
        $options['format'] = $format;
        return [$format, $options];
    }
}
