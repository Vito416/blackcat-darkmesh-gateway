<?php
declare(strict_types=1);

namespace BlackCat\Auth\Identity;

interface IdentityProviderInterface
{
    /** @return array{id:string,email?:string,roles?:list<string>, ...}|null */
    public function validateCredentials(string $username, string $password): ?array;

    /** @return array{id:string,email?:string,roles?:list<string>, ...}|null */
    public function findById(string $id): ?array;

    /**
     * @param array<string,mixed> $identity
     * @return array<string,mixed>
     */
    public function claims(array $identity): array;
}
