<?php
declare(strict_types=1);

namespace BlackCat\Auth\PasswordReset;

interface PasswordResetDeliveryInterface
{
    public function queuePasswordResetEmail(
        string $email,
        ?int $userId,
        string $resetToken,
        string $resetLink,
        int $ttlSeconds,
    ): void;
}

