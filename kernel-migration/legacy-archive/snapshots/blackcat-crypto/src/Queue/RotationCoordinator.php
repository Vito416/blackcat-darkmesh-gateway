<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Queue;

use BlackCat\Crypto\CryptoManager;
use BlackCat\Crypto\Support\Envelope;
use Psr\Log\LoggerInterface;

final class RotationCoordinator
{
    private readonly ?\Closure $persistCallback;

    public function __construct(
        private readonly CryptoManager $crypto,
        private readonly WrapQueueInterface $queue,
        ?callable $persistCallback = null,
        private readonly ?LoggerInterface $logger = null,
        private readonly int $maxAttempts = 3,
    ) {
        $this->persistCallback = $persistCallback
            ? \Closure::fromCallable($persistCallback)
            : null;
    }

    public function schedule(Envelope $envelope): void
    {
        $this->queue->enqueue(new WrapJob($envelope->context, $envelope->encode()));
    }

    public function drain(int $limit = 50): int
    {
        return $this->process($limit);
    }

    public function process(int $limit = 10): int
    {
        $processed = 0;
        while ($processed < $limit && ($job = $this->queue->dequeue())) {
            $processed++;
            try {
                $envelope = Envelope::decode($job->payload);
                $plaintext = $this->crypto->decryptContext($job->context, $job->payload, ['skipRotation' => true]);
                $newEnvelope = $this->crypto->encryptContext($job->context, $plaintext, [
                    // use -1 so CryptoManager's +1 yields 0 (freshly rotated; won't immediately reschedule)
                    'wrapCount' => -1,
                ]);
                if ($this->persistCallback) {
                    ($this->persistCallback)($job->context, $newEnvelope);
                }
            } catch (\Throwable $e) {
                $job->attempts++;
                $job->lastError = $e->getMessage();
                $job->lastErrorAt = time();
                if ($job->attempts < $this->maxAttempts) {
                    $this->queue->enqueue($job->requeue());
                } else {
                    $this->logger?->error('wrap-job-permanently-failed', [
                        'context' => $job->context,
                        'error' => $e->getMessage(),
                        'jobId' => $job->id,
                        'attempts' => $job->attempts,
                    ]);
                }
                $this->logger?->warning('wrap-job-failed', [
                    'context' => $job->context,
                    'error' => $e->getMessage(),
                    'attempts' => $job->attempts,
                    'jobId' => $job->id,
                ]);
            }
        }
        return $processed;
    }
}
