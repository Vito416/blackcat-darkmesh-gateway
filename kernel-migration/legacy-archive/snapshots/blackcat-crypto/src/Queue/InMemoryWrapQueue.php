<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Queue;

use SplQueue;

final class InMemoryWrapQueue implements WrapQueueInterface
{
    /** @var SplQueue<WrapJob> */
    private SplQueue $queue;

    public function __construct()
    {
        $this->queue = new SplQueue();
    }

    public function enqueue(WrapJob $job): void
    {
        $this->queue->enqueue(clone $job);
    }

    public function dequeue(): ?WrapJob
    {
        return $this->queue->isEmpty() ? null : $this->queue->dequeue();
    }

    public function size(): int
    {
        return $this->queue->count();
    }

    public function peek(int $limit = 25): array
    {
        $limit = max(1, $limit);
        $snapshot = [];
        $cursor = clone $this->queue;
        $cursor->setIteratorMode(SplQueue::IT_MODE_FIFO);
        $count = 0;
        foreach ($cursor as $job) {
            if ($count++ >= $limit) {
                break;
            }
            $snapshot[] = clone $job;
        }
        return $snapshot;
    }
}
