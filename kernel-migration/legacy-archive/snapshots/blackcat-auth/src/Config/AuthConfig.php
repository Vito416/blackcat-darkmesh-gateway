<?php
declare(strict_types=1);

namespace BlackCat\Auth\Config;

use BlackCat\Config\Runtime\Config as RuntimeConfig;

final class AuthConfig
{
    /**
     * @param array<string,mixed> $roles
     * @param array<string,mixed> $clients
     * @param array<string,mixed> $sessionStore
     * @param list<string> $eventWebhooks
     */
    public function __construct(
        private readonly string $issuer,
        private readonly string $audience,
        private readonly string $signingKey,
        private readonly int $accessTtl,
        private readonly int $refreshTtl,
        private readonly array $roles = [],
        private readonly array $clients = [],
        private readonly int $pkceWindow = 300,
        private readonly string $publicBaseUrl = '',
        private readonly ?int $sessionTtl = null,
        private readonly array $sessionStore = [],
        private readonly ?int $magicLinkTtl = null,
        private readonly string $magicLinkUrl = '',
        private readonly int $magicLinkThrottleWindowSec = 300,
        private readonly int $magicLinkThrottleMaxPerIp = 100,
        private readonly int $magicLinkThrottleMaxPerEmail = 5,
        private readonly ?string $webauthnRpId = null,
        private readonly ?string $webauthnRpName = null,
        private readonly int $webauthnChallengeTtlSec = 600,
        private readonly int $eventsBufferSize = 200,
        private readonly array $eventWebhooks = [],
        private readonly bool $requireEmailVerification = true,
        private readonly int $emailVerificationTtl = 86400,
        private readonly string $emailVerificationLinkTemplate = '',
        private readonly bool $devReturnVerificationToken = false,
        private readonly int $passwordResetTtl = 3600,
        private readonly string $passwordResetLinkTemplate = '',
        private readonly bool $devReturnPasswordResetToken = false,
        private readonly int $passwordMinLength = 8,
        private readonly bool $devReturnMagicLinkToken = false,
        private readonly int $passwordResetThrottleWindowSec = 300,
        private readonly int $passwordResetThrottleMaxPerIp = 50,
        private readonly int $passwordResetThrottleMaxPerEmail = 3,
        private readonly int $verifyEmailResendThrottleWindowSec = 300,
        private readonly int $verifyEmailResendThrottleMaxPerIp = 50,
        private readonly int $verifyEmailResendThrottleMaxPerEmail = 3,
    ) {}

    /**
     * @param array<string,mixed> $env
     */
    public static function fromEnv(array $env = []): self
    {
        $env = $env ?: $_ENV + $_SERVER;

        if (!RuntimeConfig::isInitialized()) {
            RuntimeConfig::tryInitFromFirstAvailableJsonFile();
        }
        if (!RuntimeConfig::isInitialized()) {
            throw new \RuntimeException('Runtime config is not initialized (required by blackcat-auth).');
        }

        $issuer = (string)($env['BLACKCAT_AUTH_ISSUER'] ?? 'blackcat-auth');
        $audience = (string)($env['BLACKCAT_AUTH_AUDIENCE'] ?? 'blackcat-clients');
        $signingKey = null;
        $access = (int)($env['BLACKCAT_AUTH_ACCESS_TTL'] ?? 900);
        $refresh = (int)($env['BLACKCAT_AUTH_REFRESH_TTL'] ?? 604800);
        $roles = json_decode($env['BLACKCAT_AUTH_ROLES'] ?? '[]', true) ?: [];
        $clients = json_decode($env['BLACKCAT_AUTH_CLIENTS'] ?? '[]', true) ?: [];
        $pkceWindow = (int)($env['BLACKCAT_AUTH_PKCE_TTL'] ?? 300);
        $baseUrl = (string)($env['BLACKCAT_AUTH_BASE_URL'] ?? $issuer);

        try {
            $v = RuntimeConfig::get('auth.issuer');
            if (is_string($v) && trim($v) !== '') {
                $issuer = trim($v);
            }
        } catch (\Throwable) {
        }
        try {
            $v = RuntimeConfig::get('auth.audience');
            if (is_string($v) && trim($v) !== '') {
                $audience = trim($v);
            }
        } catch (\Throwable) {
        }
        try {
            $v = RuntimeConfig::get('auth.signing_key');
            if (is_string($v) && trim($v) !== '') {
                $signingKey = trim($v);
            }
        } catch (\Throwable) {
        }

        try {
            $v = RuntimeConfig::get('auth.access_ttl');
            if (is_int($v)) {
                $access = $v;
            } elseif (is_string($v) && ctype_digit(trim($v))) {
                $access = (int)trim($v);
            }
        } catch (\Throwable) {
        }
        try {
            $v = RuntimeConfig::get('auth.refresh_ttl');
            if (is_int($v)) {
                $refresh = $v;
            } elseif (is_string($v) && ctype_digit(trim($v))) {
                $refresh = (int)trim($v);
            }
        } catch (\Throwable) {
        }
        try {
            $v = RuntimeConfig::get('auth.pkce_ttl');
            if (is_int($v)) {
                $pkceWindow = $v;
            } elseif (is_string($v) && ctype_digit(trim($v))) {
                $pkceWindow = (int)trim($v);
            }
        } catch (\Throwable) {
        }
        try {
            $v = RuntimeConfig::get('auth.base_url');
            if (is_string($v) && trim($v) !== '') {
                $baseUrl = trim($v);
            }
        } catch (\Throwable) {
        }

        try {
            $v = RuntimeConfig::get('auth.roles');
            if (is_array($v)) {
                $roles = $v;
            }
        } catch (\Throwable) {
        }
        try {
            $v = RuntimeConfig::get('auth.clients');
            if (is_array($v)) {
                $clients = $v;
            }
        } catch (\Throwable) {
        }

        if (!is_string($signingKey) || trim($signingKey) === '') {
            throw new \RuntimeException('Auth signing key is missing. Configure runtime config key "auth.signing_key".');
        }
        $signingKey = trim($signingKey);

        $sessionTtl = isset($env['BLACKCAT_AUTH_SESSION_TTL']) ? (int)$env['BLACKCAT_AUTH_SESSION_TTL'] : null;
        $sessionStore = json_decode($env['BLACKCAT_AUTH_SESSION_STORE'] ?? '[]', true) ?: [];
        $magicLinkTtl = isset($env['BLACKCAT_AUTH_MAGICLINK_TTL']) ? (int)$env['BLACKCAT_AUTH_MAGICLINK_TTL'] : null;
        $magicLinkUrl = (string)($env['BLACKCAT_AUTH_MAGICLINK_URL'] ?? ($baseUrl . '/magic-login'));
        $devReturnMagicRaw = (string)($env['BLACKCAT_AUTH_DEV_RETURN_MAGICLINK_TOKEN'] ?? '0');
        $devReturnMagic = in_array(strtolower(trim($devReturnMagicRaw)), ['1', 'true', 'yes', 'on'], true);
        $magicThrottleWindow = isset($env['BLACKCAT_AUTH_MAGICLINK_THROTTLE_WINDOW_SEC'])
            ? max(0, (int)$env['BLACKCAT_AUTH_MAGICLINK_THROTTLE_WINDOW_SEC'])
            : 300;
        $magicThrottleMaxIp = isset($env['BLACKCAT_AUTH_MAGICLINK_THROTTLE_MAX_PER_IP'])
            ? max(0, (int)$env['BLACKCAT_AUTH_MAGICLINK_THROTTLE_MAX_PER_IP'])
            : 100;
        $magicThrottleMaxEmail = isset($env['BLACKCAT_AUTH_MAGICLINK_THROTTLE_MAX_PER_EMAIL'])
            ? max(0, (int)$env['BLACKCAT_AUTH_MAGICLINK_THROTTLE_MAX_PER_EMAIL'])
            : 5;
        $webauthnRpId = $env['BLACKCAT_AUTH_WEBAUTHN_RP_ID'] ?? null;
        $webauthnRpName = $env['BLACKCAT_AUTH_WEBAUTHN_RP_NAME'] ?? null;
        $webauthnChallengeTtlSec = isset($env['BLACKCAT_AUTH_WEBAUTHN_CHALLENGE_TTL'])
            ? max(0, (int)$env['BLACKCAT_AUTH_WEBAUTHN_CHALLENGE_TTL'])
            : 600;
        $eventsBuffer = isset($env['BLACKCAT_AUTH_EVENTS_BUFFER']) ? max(10, (int)$env['BLACKCAT_AUTH_EVENTS_BUFFER']) : 200;
        $eventWebhooks = json_decode($env['BLACKCAT_AUTH_EVENT_WEBHOOKS'] ?? '[]', true) ?: [];

        $requireEmailVerificationRaw = (string)($env['BLACKCAT_AUTH_REQUIRE_EMAIL_VERIFICATION'] ?? '1');
        $requireEmailVerification = !in_array(strtolower(trim($requireEmailVerificationRaw)), ['0', 'false', 'no', 'off'], true);
        $emailVerificationTtl = isset($env['BLACKCAT_AUTH_EMAIL_VERIFICATION_TTL'])
            ? max(60, (int)$env['BLACKCAT_AUTH_EMAIL_VERIFICATION_TTL'])
            : 86400;
        $emailVerificationLinkTemplate = (string)($env['BLACKCAT_AUTH_EMAIL_VERIFICATION_LINK_TEMPLATE'] ?? '');
        $devReturnTokenRaw = (string)($env['BLACKCAT_AUTH_DEV_RETURN_VERIFICATION_TOKEN'] ?? '0');
        $devReturnToken = in_array(strtolower(trim($devReturnTokenRaw)), ['1', 'true', 'yes', 'on'], true);

        $passwordResetTtl = isset($env['BLACKCAT_AUTH_PASSWORD_RESET_TTL'])
            ? max(60, (int)$env['BLACKCAT_AUTH_PASSWORD_RESET_TTL'])
            : 3600;
        $passwordResetLinkTemplate = (string)($env['BLACKCAT_AUTH_PASSWORD_RESET_LINK_TEMPLATE'] ?? '');
        $devReturnResetRaw = (string)($env['BLACKCAT_AUTH_DEV_RETURN_PASSWORD_RESET_TOKEN'] ?? '0');
        $devReturnReset = in_array(strtolower(trim($devReturnResetRaw)), ['1', 'true', 'yes', 'on'], true);

        $passwordMinLength = isset($env['BLACKCAT_AUTH_PASSWORD_MIN_LENGTH'])
            ? max(1, (int)$env['BLACKCAT_AUTH_PASSWORD_MIN_LENGTH'])
            : 8;

        $passwordResetThrottleWindow = isset($env['BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_WINDOW_SEC'])
            ? max(0, (int)$env['BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_WINDOW_SEC'])
            : 300;
        $passwordResetThrottleMaxIp = isset($env['BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_MAX_PER_IP'])
            ? max(0, (int)$env['BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_MAX_PER_IP'])
            : 50;
        $passwordResetThrottleMaxEmail = isset($env['BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_MAX_PER_EMAIL'])
            ? max(0, (int)$env['BLACKCAT_AUTH_PASSWORD_RESET_THROTTLE_MAX_PER_EMAIL'])
            : 3;

        $verifyResendThrottleWindow = isset($env['BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_WINDOW_SEC'])
            ? max(0, (int)$env['BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_WINDOW_SEC'])
            : 300;
        $verifyResendThrottleMaxIp = isset($env['BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_MAX_PER_IP'])
            ? max(0, (int)$env['BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_MAX_PER_IP'])
            : 50;
        $verifyResendThrottleMaxEmail = isset($env['BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_MAX_PER_EMAIL'])
            ? max(0, (int)$env['BLACKCAT_AUTH_VERIFY_EMAIL_RESEND_THROTTLE_MAX_PER_EMAIL'])
            : 3;

        return new self(
            $issuer,
            $audience,
            $signingKey,
            $access,
            $refresh,
            $roles,
            $clients,
            max(60, $pkceWindow),
            rtrim($baseUrl, '/'),
            $sessionTtl && $sessionTtl > 0 ? $sessionTtl : null,
            $sessionStore,
            $magicLinkTtl && $magicLinkTtl > 0 ? $magicLinkTtl : null,
            rtrim($magicLinkUrl, '/'),
            $magicThrottleWindow,
            $magicThrottleMaxIp,
            $magicThrottleMaxEmail,
            $webauthnRpId ? strtolower(trim($webauthnRpId)) : null,
            $webauthnRpName ? trim($webauthnRpName) : null,
            $webauthnChallengeTtlSec,
            $eventsBuffer,
            array_values(array_filter(array_map(static fn($url) => is_string($url) ? trim($url) : null, $eventWebhooks))),
            $requireEmailVerification,
            $emailVerificationTtl,
            trim($emailVerificationLinkTemplate),
            $devReturnToken,
            $passwordResetTtl,
            trim($passwordResetLinkTemplate),
            $devReturnReset,
            $passwordMinLength,
            $devReturnMagic,
            $passwordResetThrottleWindow,
            $passwordResetThrottleMaxIp,
            $passwordResetThrottleMaxEmail,
            $verifyResendThrottleWindow,
            $verifyResendThrottleMaxIp,
            $verifyResendThrottleMaxEmail,
        );
    }

    public function issuer(): string { return $this->issuer; }
    public function audience(): string { return $this->audience; }
    public function signingKey(): string { return $this->signingKey; }
    public function accessTtl(): int { return $this->accessTtl; }
    public function refreshTtl(): int { return $this->refreshTtl; }
    /** @return array<string,mixed> */
    public function roles(): array { return $this->roles; }
    /** @return array<string,mixed> */
    public function clients(): array { return $this->clients; }
    public function pkceWindow(): int { return $this->pkceWindow; }
    public function publicBaseUrl(): string
    {
        return $this->publicBaseUrl ?: $this->issuer;
    }

    public function sessionTtl(): ?int
    {
        return $this->sessionTtl;
    }

    /** @return array<string,mixed> */
    public function sessionStoreConfig(): array
    {
        return $this->sessionStore;
    }

    public function magicLinkTtl(): ?int
    {
        return $this->magicLinkTtl;
    }

    public function magicLinkUrl(): string
    {
        return $this->magicLinkUrl ?: ($this->publicBaseUrl . '/magic-login');
    }

    public function magicLinkThrottleWindowSec(): int
    {
        return max(0, $this->magicLinkThrottleWindowSec);
    }

    public function magicLinkThrottleMaxPerIp(): int
    {
        return max(0, $this->magicLinkThrottleMaxPerIp);
    }

    public function magicLinkThrottleMaxPerEmail(): int
    {
        return max(0, $this->magicLinkThrottleMaxPerEmail);
    }

    public function webauthnRpId(): ?string
    {
        return $this->webauthnRpId;
    }

    public function webauthnRpName(): ?string
    {
        return $this->webauthnRpName;
    }

    public function webauthnChallengeTtlSec(): int
    {
        // Minimum 30s to avoid accidental 0/too-low TTL; <=0 falls back to default 600s.
        $ttl = $this->webauthnChallengeTtlSec;
        if ($ttl <= 0) {
            return 600;
        }
        return max(30, $ttl);
    }

    public function eventsBufferSize(): int
    {
        return $this->eventsBufferSize;
    }

    /**
     * @return list<string>
     */
    public function eventWebhooks(): array
    {
        return $this->eventWebhooks;
    }

    public function requireEmailVerification(): bool
    {
        return $this->requireEmailVerification;
    }

    public function emailVerificationTtl(): int
    {
        return $this->emailVerificationTtl;
    }

    public function emailVerificationLinkTemplate(): string
    {
        return $this->emailVerificationLinkTemplate;
    }

    public function devReturnVerificationToken(): bool
    {
        return $this->devReturnVerificationToken;
    }

    public function passwordResetTtl(): int
    {
        return $this->passwordResetTtl;
    }

    public function passwordResetLinkTemplate(): string
    {
        return $this->passwordResetLinkTemplate;
    }

    public function passwordResetThrottleWindowSec(): int
    {
        return max(0, $this->passwordResetThrottleWindowSec);
    }

    public function passwordResetThrottleMaxPerIp(): int
    {
        return max(0, $this->passwordResetThrottleMaxPerIp);
    }

    public function passwordResetThrottleMaxPerEmail(): int
    {
        return max(0, $this->passwordResetThrottleMaxPerEmail);
    }

    public function verifyEmailResendThrottleWindowSec(): int
    {
        return max(0, $this->verifyEmailResendThrottleWindowSec);
    }

    public function verifyEmailResendThrottleMaxPerIp(): int
    {
        return max(0, $this->verifyEmailResendThrottleMaxPerIp);
    }

    public function verifyEmailResendThrottleMaxPerEmail(): int
    {
        return max(0, $this->verifyEmailResendThrottleMaxPerEmail);
    }

    public function devReturnPasswordResetToken(): bool
    {
        return $this->devReturnPasswordResetToken;
    }

    public function devReturnMagicLinkToken(): bool
    {
        return $this->devReturnMagicLinkToken;
    }

    public function passwordMinLength(): int
    {
        return $this->passwordMinLength;
    }
}
