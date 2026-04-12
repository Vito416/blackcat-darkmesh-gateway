<?php
declare(strict_types=1);

namespace BlackCat\Auth\MagicLink;

final class MagicLinkService
{
    public function __construct(
        private readonly MagicLinkStoreInterface $store,
        private readonly int $ttlSeconds,
        private readonly string $baseUrl,
        private readonly string $secret,
    ) {}

    /**
     * @param array<string,mixed> $context
     * @return array{token:string,expires_at:int,link:string}
     */
    public function issue(string $subject, array $context = []): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $fingerprint = $this->fingerprint($token);
        $expires = time() + $this->ttlSeconds;
        $entry = new MagicLinkToken($fingerprint, $subject, $context, $expires);
        $this->store->save($entry);
        return [
            'token' => $token,
            'expires_at' => $expires,
            'link' => $this->baseUrl . '?token=' . $token,
        ];
    }

    /**
     * @return array{subject:string,context:array<string,mixed>}|null
     */
    public function consume(string $token): ?array
    {
        $fingerprint = $this->fingerprint($token);
        $entry = $this->store->find($fingerprint);
        if ($entry === null) {
            return null;
        }
        if ($entry->isExpired()) {
            $this->store->delete($fingerprint);
            return null;
        }
        $this->store->delete($fingerprint);
        return [
            'subject' => $entry->subject,
            'context' => $entry->context,
        ];
    }

    private function fingerprint(string $token): string
    {
        return hash_hmac('sha256', $token, $this->secret);
    }
}
