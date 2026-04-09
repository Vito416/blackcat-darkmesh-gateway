<?php
declare(strict_types=1);

namespace BlackCat\Auth\WebAuthn;

final class InMemoryWebAuthnStore implements WebAuthnStoreInterface
{
    /** @var array<string,list<WebAuthnCredential>> */
    private array $credentials = [];

    /** @var array<string,array<string,mixed>> */
    private array $challenges = [];

    public function saveCredentials(string $subject, array $credentials): void
    {
        $this->credentials[$subject] = $credentials;
    }

    public function loadCredentials(string $subject): array
    {
        return $this->credentials[$subject] ?? [];
    }

    /** @param array<string,mixed> $metadata */
    public function rememberChallenge(string $challenge, array $metadata): void
    {
        $this->challenges[$challenge] = $metadata;
    }

    /** @return array<string,mixed>|null */
    public function consumeChallenge(string $challenge): ?array
    {
        if (!isset($this->challenges[$challenge])) {
            return null;
        }
        $metadata = $this->challenges[$challenge];
        unset($this->challenges[$challenge]);
        return $metadata;
    }

    public function touchCredential(string $subject, string $credentialId, ?int $signCount = null): bool
    {
        $subject = trim($subject);
        $credentialId = trim($credentialId);
        if ($subject === '' || $credentialId === '') {
            return false;
        }

        foreach ($this->credentials[$subject] ?? [] as $cred) {
            if ($cred instanceof WebAuthnCredential && $cred->id === $credentialId) {
                return true;
            }
        }
        return false;
    }
}
