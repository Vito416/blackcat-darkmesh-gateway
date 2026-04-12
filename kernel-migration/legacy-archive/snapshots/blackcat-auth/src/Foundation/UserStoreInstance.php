<?php
declare(strict_types=1);

namespace BlackCat\Auth\Foundation;

use BlackCat\Core\Database;
use BlackCat\Auth\Identity\IdentityProviderInterface;
use BlackCat\Auth\Password\PasswordHasher;

final class UserStoreInstance
{
    public function __construct(
        private readonly IdentityProviderInterface $provider,
        private readonly ?Database $db,
        private readonly ?PasswordHasher $hasher
    ) {
    }

    public function provider(): IdentityProviderInterface
    {
        return $this->provider;
    }

    public function db(): ?Database
    {
        return $this->db;
    }

    public function hasher(): ?PasswordHasher
    {
        return $this->hasher;
    }
}
