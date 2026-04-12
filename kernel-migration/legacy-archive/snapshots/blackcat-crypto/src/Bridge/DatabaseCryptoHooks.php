<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Bridge;

use BlackCat\Crypto\Telemetry\IntentCollector;
use BlackCat\Crypto\Telemetry\TelemetryExporter;
use BlackCat\Crypto\Queue\WrapQueueInterface;

/**
 * Convenience bridge for database integration: emits telemetry snapshots that
 * can be consumed by CI or docs pipelines in the database-crypto repo.
 */
final class DatabaseCryptoHooks
{
    public function __construct(private IntentCollector $collector) {}

    /**
     * @param array<int,array<string,mixed>> $kmsHealth
     * @param WrapQueueInterface|null $queue
     * @return array<string,mixed>
     */
    public function telemetrySnapshot(array $kmsHealth = [], ?WrapQueueInterface $queue = null, ?IntentCollector $collector = null): array
    {
        $ciMeta = [
            'ci' => getenv('CI') ?: null,
            'repo' => getenv('GITHUB_REPOSITORY') ?: null,
            'run_id' => getenv('GITHUB_RUN_ID') ?: null,
            'workflow' => getenv('GITHUB_WORKFLOW') ?: null,
            'job' => getenv('GITHUB_JOB') ?: null,
        ];

        $snapshot = TelemetryExporter::snapshot(
            kmsHealth: $kmsHealth,
            queue: $queue,
            collector: $collector ?? $this->collector,
            ciMeta: array_filter($ciMeta, static fn($v) => $v !== null)
        );

        $snapshotPath = getenv('DB_CRYPTO_SNAPSHOT_PATH');
        if (is_string($snapshotPath) && $snapshotPath !== '') {
            @file_put_contents($snapshotPath, json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }
        return $snapshot;
    }
}
