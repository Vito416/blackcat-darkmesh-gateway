<?php
declare(strict_types=1);

namespace BlackCat\Auth\Registration;

interface EmailVerificationDeliveryInterface
{
    public function queueVerificationEmail(
        string $email,
        ?int $userId,
        string $verificationToken,
        string $verificationLink,
        int $ttlSeconds,
    ): void;
}

