<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Rotation;

use BlackCat\Crypto\Queue\WrapJob;
use BlackCat\Crypto\Queue\WrapQueueInterface;
use Psr\Log\LoggerInterface;

final class TenantRewrapOrchestrator
{
    public function __construct(
        private readonly WrapQueueInterface $queue,
        private readonly ?LoggerInterface $logger = null
    ) {}

    /**
     * @param array<string,mixed> $event
     */
    public function trigger(array $event): void
    {
        $tenant = (string)($event['tenant'] ?? 'unknown');
        $contexts = (array)($event['contexts'] ?? []);
        if ($contexts === []) {
            $contexts[] = 'tenant:' . $tenant;
        }
        $source = (string)($event['source'] ?? 'unknown');
        $metadata = [
            'tenant' => $tenant,
            'source' => $source,
            'reason' => $event['reason'] ?? 'config_change',
        ];
        $payload = json_encode($metadata, JSON_UNESCAPED_SLASHES);
        foreach ($contexts as $context) {
            $job = new WrapJob($context, $payload ?: '{}');
            $this->queue->enqueue($job);
            $this->logger?->info('crypto.rewrap.queued', [
                'tenant' => $tenant,
                'context' => $context,
                'source' => $source,
            ]);
        }
    }
}
