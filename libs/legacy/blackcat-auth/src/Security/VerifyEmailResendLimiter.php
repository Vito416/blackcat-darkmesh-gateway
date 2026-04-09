<?php
declare(strict_types=1);

namespace BlackCat\Auth\Security;

final class VerifyEmailResendLimiter
{
    private function __construct() {}

    /**
     * Throttle for `POST /verify-email/resend`.
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
            'verify_email_resend',
        );
    }
}

