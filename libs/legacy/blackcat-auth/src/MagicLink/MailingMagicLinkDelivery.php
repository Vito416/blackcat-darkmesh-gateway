<?php
declare(strict_types=1);

namespace BlackCat\Auth\MagicLink;

use BlackCat\Mailing\Queue\EmailQueueInterface;

final class MailingMagicLinkDelivery implements MagicLinkDeliveryInterface
{
    public function __construct(
        private readonly EmailQueueInterface $queue,
        private readonly string $template = 'magic_link',
        private readonly int $priority = 10,
        private readonly string $appName = 'BlackCat',
    ) {}

    public function queueMagicLinkEmail(
        string $email,
        ?int $userId,
        string $token,
        string $link,
        int $ttlSeconds,
    ): void {
        $email = trim($email);
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('invalid_email');
        }
        $link = trim($link);
        if ($link === '') {
            throw new \InvalidArgumentException('missing_magic_link');
        }

        $payload = [
            'to_email' => $email,
            'to_name' => null,
            'vars' => [
                'magic_link_url' => $link,
                'app_name' => $this->appName,
                'ttl_seconds' => max(0, $ttlSeconds),
                'token' => $token,
            ],
        ];

        $this->queue->enqueueEmail(
            $this->template,
            $payload,
            $userId && $userId > 0 ? $userId : null,
            $this->priority,
        );
    }
}
