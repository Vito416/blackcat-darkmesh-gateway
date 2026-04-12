<?php
declare(strict_types=1);

namespace BlackCat\Auth\WebAuthn;

final class WebAuthnService
{
    public function __construct(
        private readonly WebAuthnStoreInterface $store,
        private readonly string $rpId,
        private readonly string $rpName,
    ) {}

    /** @return array{id:string,name:string} */
    public function relyingParty(): array
    {
        return ['id' => $this->rpId, 'name' => $this->rpName];
    }

    /** @return array{challenge:string,rp:array{id:string,name:string},excludeCredentials:list<string>} */
    public function startRegistration(string $subject): array
    {
        $challenge = $this->challenge();
        $this->store->rememberChallenge($challenge, [
            'type' => 'register',
            'subject' => $subject,
        ]);
        $exclude = array_map(fn(WebAuthnCredential $cred) => $cred->id, $this->store->loadCredentials($subject));
        return [
            'challenge' => $challenge,
            'rp' => $this->relyingParty(),
            'excludeCredentials' => $exclude,
        ];
    }

    public function finishRegistration(string $subject, string $challenge, string $credentialId, string $publicKey): bool
    {
        $metadata = $this->store->consumeChallenge($challenge);
        if (!$metadata || ($metadata['type'] ?? '') !== 'register' || ($metadata['subject'] ?? '') !== $subject) {
            return false;
        }
        $existing = $this->store->loadCredentials($subject);
        $existing[] = new WebAuthnCredential($credentialId, $publicKey, time());
        $this->store->saveCredentials($subject, $existing);
        return true;
    }

    /** @return array{challenge:string,allowCredentials:list<string>}|null */
    public function startAuthentication(string $subject): ?array
    {
        $credentials = $this->store->loadCredentials($subject);
        if ($credentials === []) {
            return null;
        }
        $challenge = $this->challenge();
        $allow = array_map(
            fn(WebAuthnCredential $cred) => $cred->id,
            $credentials
        );
        $this->store->rememberChallenge($challenge, [
            'type' => 'authenticate',
            'subject' => $subject,
            'allowed' => $allow,
        ]);
        return [
            'challenge' => $challenge,
            'allowCredentials' => $allow,
        ];
    }

    public function finishAuthentication(string $subject, string $challenge, string $credentialId, ?int $signCount = null): bool
    {
        $metadata = $this->store->consumeChallenge($challenge);
        if (!$metadata || ($metadata['type'] ?? '') !== 'authenticate') {
            return false;
        }
        if (($metadata['subject'] ?? '') !== $subject) {
            return false;
        }
        $allowed = $metadata['allowed'] ?? [];
        if (!in_array($credentialId, $allowed, true)) {
            return false;
        }
        $credentials = $this->store->loadCredentials($subject);
        foreach ($credentials as $credential) {
            if ($credential->id === $credentialId) {
                return $this->store->touchCredential($subject, $credentialId, $signCount);
            }
        }
        return false;
    }

    private function challenge(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }
}
