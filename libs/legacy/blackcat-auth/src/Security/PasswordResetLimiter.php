<?php
declare(strict_types=1);

namespace BlackCat\Auth\Security;

final class PasswordResetLimiter
{
    private function __construct() {}

    /**
     * Throttle for `POST /password-reset/request`.
     *
     * @throws TooManyAttemptsException
     */
    public static function assertAllowed(?string $ip, string $email, int $maxPerIp, int $maxPerEmail, int $windowSec): void
    {
        RateLimitCountersLimiter::assertAllowed(
            $ip,
            $email,
            $maxPerIp,
            $maxPerEmail,
            $windowSec,
            'password_reset_request',
        );
    }
}

