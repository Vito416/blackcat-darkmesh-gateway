<?php
declare(strict_types=1);

namespace BlackCat\Auth\WebAuthn;

interface WebAuthnStoreInterface
{
    /**
     * @param list<WebAuthnCredential> $credentials
     */
    public function saveCredentials(string $subject, array $credentials): void;

    /**
     * @return list<WebAuthnCredential>
     */
    public function loadCredentials(string $subject): array;

    /** @param array<string,mixed> $metadata */
    public function rememberChallenge(string $challenge, array $metadata): void;

    /** @return array<string,mixed>|null */
    public function consumeChallenge(string $challenge): ?array;

    /**
     * Persist usage metadata for a credential (prod hardening):
     * - update `last_used_at`
     * - optionally validate & store WebAuthn signature counter (`sign_count`)
     *
     * Return false when the credential is missing or the sign counter indicates replay/clone.
     */
    public function touchCredential(string $subject, string $credentialId, ?int $signCount = null): bool;
}
