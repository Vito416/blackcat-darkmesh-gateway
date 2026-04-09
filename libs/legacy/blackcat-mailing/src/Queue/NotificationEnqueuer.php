<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Queue;

use BlackCat\Core\Database;
use BlackCat\Database\Packages\Notifications\Repository\NotificationRepository;

final class NotificationEnqueuer implements EmailQueueInterface
{
    public function __construct(
        private readonly Database $db,
        private readonly NotificationRepository $notifications,
        private readonly TenantResolverInterface $tenants,
    ) {}

    /**
     * @param array<string,mixed> $payload
     */
    public function enqueueEmail(
        string $template,
        array $payload,
        ?int $userId = null,
        int $priority = 0,
        int $maxRetries = 6,
    ): int {
        $template = trim($template);
        if ($template === '') {
            throw new \InvalidArgumentException('template must not be empty');
        }

        $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($payloadJson === false) {
            throw new \RuntimeException('Unable to encode notification payload');
        }

        $row = [
            'tenant_id' => $this->tenants->resolveTenantId(),
            'user_id' => $userId && $userId > 0 ? $userId : null,
            'channel' => 'email',
            'template' => $template,
            'payload' => $payloadJson,
            'status' => 'pending',
            'retries' => 0,
            'max_retries' => max(0, $maxRetries),
            'priority' => $priority,
        ];

        $this->notifications->insert($row);

        $id = $this->db->lastInsertId();
        if (!is_string($id) || $id === '') {
            return 0;
        }
        return (int)$id;
    }
}
