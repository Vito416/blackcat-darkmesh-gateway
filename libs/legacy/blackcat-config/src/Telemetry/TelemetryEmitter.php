<?php

declare(strict_types=1);

namespace BlackCat\Config\Telemetry;

use DateTimeImmutable;
use RuntimeException;

final class TelemetryEmitter
{
    public function __construct(private readonly string $channel)
    {
    }

    public static function forChannel(string $channel): self
    {
        return new self($channel);
    }

    /**
     * @param array<string,mixed> $context
     */
    public function emit(string $event, array $context = []): void
    {
        $payload = [
            'ts' => (new DateTimeImmutable())->format(DATE_ATOM),
            'event' => $event,
            'context' => $context,
        ];

        $this->write(json_encode($payload, JSON_THROW_ON_ERROR));
    }

    /**
     * @return array<int,string>
     */
    public function tail(int $lines = 20): array
    {
        if ($this->channel === 'stdout') {
            return ['stdout channel has no persisted history'];
        }

        $path = $this->resolvePath($this->channel);
        if (!is_file($path)) {
            return [];
        }

        $buffer = file($path, FILE_IGNORE_NEW_LINES);
        if ($buffer === false) {
            return [];
        }

        return array_slice($buffer, -$lines);
    }

    private function write(string $line): void
    {
        if ($this->channel === 'stdout') {
            fwrite(STDOUT, $line . PHP_EOL);
            return;
        }

        $path = $this->resolvePath($this->channel);
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException("Unable to create telemetry directory {$dir}");
        }

        $result = file_put_contents($path, $line . PHP_EOL, FILE_APPEND);
        if ($result === false) {
            throw new RuntimeException("Unable to write telemetry event to {$path}");
        }
    }

    private function resolvePath(string $channel): string
    {
        if (strpos($channel, 'file://') === 0) {
            return substr($channel, 7);
        }

        return $channel;
    }
}
