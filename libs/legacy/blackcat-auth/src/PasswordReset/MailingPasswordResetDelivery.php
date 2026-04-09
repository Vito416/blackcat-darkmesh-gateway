<?php
declare(strict_types=1);

namespace BlackCat\Auth\PasswordReset;

use BlackCat\Mailing\Queue\EmailQueueInterface;

final class MailingPasswordResetDelivery implements PasswordResetDeliveryInterface
{
    public function __construct(
        private readonly EmailQueueInterface $queue,
        private readonly string $template = 'reset_password',
        private readonly int $priority = 10,
        private readonly string $appName = 'BlackCat',
    ) {}

    public function queuePasswordResetEmail(
        string $email,
        ?int $userId,
        string $resetToken,
        string $resetLink,
        int $ttlSeconds,
    ): void {
        $email = trim($email);
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('invalid_email');
        }
        $resetLink = trim($resetLink);
        if ($resetLink === '') {
            throw new \InvalidArgumentException('missing_reset_link');
        }

        $payload = [
            'to_email' => $email,
            'to_name' => null,
            'vars' => [
                'reset_url' => $resetLink,
                'app_name' => $this->appName,
                'ttl_seconds' => max(0, $ttlSeconds),
                'token' => $resetToken,
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

