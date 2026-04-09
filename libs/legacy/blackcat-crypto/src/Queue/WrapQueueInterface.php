<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Queue;

interface WrapQueueInterface
{
    public function enqueue(WrapJob $job): void;
    public function dequeue(): ?WrapJob;
    public function size(): int;
    /** @return list<WrapJob> */
    public function peek(int $limit = 25): array;
}
