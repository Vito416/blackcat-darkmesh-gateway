<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Telemetry\IntentCollector;
use BlackCat\Crypto\Telemetry\TelemetryExporter;

final class TelemetryIntentsCommand implements CommandInterface
{
    public function name(): string
    {
        return 'telemetry:intents';
    }

    public function description(): string
    {
        return 'Export intent telemetry (counts/recent) in JSON, Prometheus, or OTLP/JSON.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $collector = IntentCollector::global();
        if ($collector === null) {
            fwrite(STDERR, "Intent collector is not active. Enable BLACKCAT_CRYPTO_INTENTS env or wire your own.\n");
            return 1;
        }

        $format = $this->parseOption($args, '--format', 'json');
        $recentLimit = (int)$this->parseOption($args, '--limit', '0');
        $snapshot = TelemetryExporter::snapshot([], null, $collector);
        if ($recentLimit > 0 && isset($snapshot['intents']['recent'])) {
            $snapshot['intents']['recent'] = array_slice($snapshot['intents']['recent'], -1 * $recentLimit);
        }

        if ($format === 'prom') {
            echo TelemetryExporter::asPrometheus($snapshot);
            return 0;
        } elseif ($format === 'otel') {
            echo json_encode(
                TelemetryExporter::asOpenTelemetry($snapshot),
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
            ) . PHP_EOL;
            return 0;
        }

        echo json_encode($snapshot['intents'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return 0;
    }

    /** @param list<string> $args */
    private function parseOption(array $args, string $name, string $default): string
    {
        foreach ($args as $index => $arg) {
            if (str_starts_with($arg, "{$name}=")) {
                return (string)substr($arg, strlen($name) + 1);
            }
            if ($arg === $name && isset($args[$index + 1])) {
                return (string)$args[$index + 1];
            }
        }
        return $default;
    }
}
