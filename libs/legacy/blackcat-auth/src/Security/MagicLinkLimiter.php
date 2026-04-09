<?php
declare(strict_types=1);

namespace BlackCat\Auth\Security;

/**
 * MagicLinkLimiter
 *
 * - Uses `rate_limit_counters` (BlackCat Database package) to throttle /magic-link/request.
 * - Uses ingress *criteria* adapter to compute deterministic hashes (no plaintext email/IP stored).
 * - Fail-open by design: limiter must never break auth flows.
 */
final class MagicLinkLimiter
{
    private function __construct() {}

    /**
     * Throws TooManyAttemptsException when throttled (429) – otherwise returns silently.
     *
     * @param string|null $ip plain client IP (REMOTE_ADDR fallback)
     */
    public static function assertAllowed(?string $ip, string $email, int $maxPerIp, int $maxPerEmail, int $windowSec): void
    {
        RateLimitCountersLimiter::assertAllowed(
            $ip,
            $email,
            $maxPerIp,
            $maxPerEmail,
            $windowSec,
            'magic_link_request',
        );
    }
}
