<?php
declare(strict_types=1);

namespace BlackCat\Auth\MagicLink;

final class InMemoryMagicLinkStore implements MagicLinkStoreInterface
{
    /** @var array<string,MagicLinkToken> */
    private array $tokens = [];

    public function save(MagicLinkToken $token): void
    {
        $this->tokens[$token->fingerprint] = $token;
    }

    public function find(string $fingerprint): ?MagicLinkToken
    {
        return $this->tokens[$fingerprint] ?? null;
    }

    public function delete(string $fingerprint): void
    {
        unset($this->tokens[$fingerprint]);
    }
}
