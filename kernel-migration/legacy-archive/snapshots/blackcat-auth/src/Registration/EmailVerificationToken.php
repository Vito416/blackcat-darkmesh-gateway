<?php
declare(strict_types=1);

namespace BlackCat\Auth\Registration;

final class EmailVerificationToken
{
    public function __construct(
        public readonly string $selector,
        public readonly string $validator,
    ) {}

    public static function issue(): self
    {
        $selector = self::base64UrlEncode(random_bytes(9));  // 12 chars
        $validator = self::base64UrlEncode(random_bytes(32)); // 43 chars
        return new self($selector, $validator);
    }

    public static function parse(string $token): ?self
    {
        $token = trim($token);
        if ($token === '' || !str_contains($token, '.')) {
            return null;
        }

        [$selector, $validator] = array_pad(explode('.', $token, 2), 2, '');
        $selector = trim($selector);
        $validator = trim($validator);

        if ($selector === '' || $validator === '') {
            return null;
        }

        if (!preg_match('~^[A-Za-z0-9_-]{12}$~', $selector)) {
            return null;
        }
        if (!preg_match('~^[A-Za-z0-9_-]{32,128}$~', $validator)) {
            return null;
        }

        if (self::base64UrlDecode($validator) === null) {
            return null;
        }

        return new self($selector, $validator);
    }

    public function token(): string
    {
        return $this->selector . '.' . $this->validator;
    }

    public function validatorHashBinary(): ?string
    {
        $bytes = self::base64UrlDecode($this->validator);
        if ($bytes === null) {
            return null;
        }
        return hash('sha256', $bytes, true);
    }

    public function tokenHashHex(): string
    {
        return hash('sha256', $this->token());
    }

    private static function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $b64url): ?string
    {
        $b64url = trim($b64url);
        if ($b64url === '') {
            return null;
        }

        $padLen = (4 - (strlen($b64url) % 4)) % 4;
        $padded = $b64url . str_repeat('=', $padLen);
        $raw = base64_decode(strtr($padded, '-_', '+/'), true);
        return ($raw === false || $raw === '') ? null : $raw;
    }
}

