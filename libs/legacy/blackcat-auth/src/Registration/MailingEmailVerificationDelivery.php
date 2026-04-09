<?php
declare(strict_types=1);

namespace BlackCat\Auth\Registration;

use BlackCat\Mailing\Queue\EmailQueueInterface;

final class MailingEmailVerificationDelivery implements EmailVerificationDeliveryInterface
{
    public function __construct(
        private readonly EmailQueueInterface $queue,
        private readonly string $template = 'verify_email',
        private readonly int $priority = 10,
        private readonly string $appName = 'BlackCat',
    ) {}

    public function queueVerificationEmail(
        string $email,
        ?int $userId,
        string $verificationToken,
        string $verificationLink,
        int $ttlSeconds,
    ): void {
        $email = trim($email);
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException('invalid_email');
        }
        $verificationLink = trim($verificationLink);
        if ($verificationLink === '') {
            throw new \InvalidArgumentException('missing_verification_link');
        }

        $payload = [
            'to_email' => $email,
            'to_name' => null,
            'vars' => [
                'verify_url' => $verificationLink,
                'app_name' => $this->appName,
                'ttl_seconds' => max(0, $ttlSeconds),
                'token' => $verificationToken,
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
