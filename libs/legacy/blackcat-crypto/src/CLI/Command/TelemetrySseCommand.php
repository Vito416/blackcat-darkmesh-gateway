<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\Kms\KmsRouter;
use BlackCat\Crypto\Telemetry\SseStreamer;
use BlackCat\Crypto\Telemetry\TelemetryExporter;
use Psr\Log\LoggerInterface;

final class TelemetrySseCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string
    {
        return 'telemetry:sse';
    }

    public function description(): string
    {
        return 'Stream telemetry snapshots as Server-Sent Events.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $interval = $this->parseOption($args, '--interval', 5);
        $iterations = $this->parseOption($args, '--iterations', 0);
        $config = CryptoConfig::fromEnv();
        $router = new KmsRouter($config->kmsConfig(), $this->logger);
        $queueFactory = $config->wrapQueueFactory();
        $queue = $queueFactory ? $queueFactory() : null;
        $streamer = new SseStreamer();
        $streamer->stream(
            static fn () => TelemetryExporter::snapshot($router->health(), $queue),
            max(1, $interval),
            $iterations > 0 ? $iterations : null
            );
        return 0;
    }

    /** @param list<string> $args */
    private function parseOption(array $args, string $name, int $default): int
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
