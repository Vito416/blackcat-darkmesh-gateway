<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Queue;

interface EmailQueueInterface
{
    /**
     * @param array<string,mixed> $payload
     */
    public function enqueueEmail(
        string $template,
        array $payload,
        ?int $userId = null,
        int $priority = 0,
        int $maxRetries = 6,
    ): int;
}

