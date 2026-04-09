<?php
declare(strict_types=1);

namespace BlackCat\Auth\Password;

final class PasswordHasher
{
    /**
     * @param array<string,int> $options
     */
    public function __construct(
        private readonly PepperProviderInterface $pepper,
        private readonly array $options = []
    ) {}

    public function hash(string $password): string
    {
        $pep = $this->pepper->current();
        $pre = hash_hmac('sha256', $password, $pep->bytes(), true);
        $hash = password_hash($pre, PASSWORD_ARGON2ID, $this->options ?: $this->defaultOptions());
        $pep->release();
        if (function_exists('sodium_memzero')) {
            @sodium_memzero($pre);
        }
        return $hash;
    }

    /**
     * Return the current pepper version for DB storage.
     *
     * This enables deterministic selection of the correct pepper during verification
     * (and faster fallbacks during rotation) without exposing the pepper itself.
     */
    public function currentPepperVersion(): string
    {
        $pep = $this->pepper->current();
        $version = $pep->version;
        $pep->release();
        return $version;
    }

    public function algorithmName(string $hash): string
    {
        $info = password_get_info($hash);
        return $info['algoName'] ?? 'unknown';
    }

    public function verify(string $password, string $hash, ?string $version = null): PasswordVerificationResult
    {
        $candidates = [];
        if ($version !== null) {
            $pep = $this->pepper->byVersion($version);
            if ($pep !== null) {
                $candidates[] = $pep;
            }
        }
        if ($candidates === []) {
            $candidates = $this->pepper->all();
        }

        foreach ($candidates as $pep) {
            $pre = hash_hmac('sha256', $password, $pep->bytes(), true);
            $ok = password_verify($pre, $hash);
            $pep->release();
            if (function_exists('sodium_memzero')) {
                @sodium_memzero($pre);
            }
            if ($ok) {
                return new PasswordVerificationResult(true, $pep->version);
            }
        }
        // fallback without pepper (legacy)
        if (password_verify($password, $hash)) {
            return new PasswordVerificationResult(true, null);
        }
        password_verify(random_bytes(16), $hash); // timing noise
        return new PasswordVerificationResult(false, null);
    }

    /** @return array<string,int> */
    private function defaultOptions(): array
    {
        return [
            'memory_cost' => 1 << 16,
            'time_cost' => 4,
            'threads' => 2,
        ];
    }
}
