<?php
declare(strict_types=1);

namespace BlackCat\Auth\Identity;

/**
 * @phpstan-type UserRecord array{
 *   id: string,
 *   password_hash: string,
 *   roles: list<string>,
 *   email?: string,
 *   username?: string
 * }
 */
final class ArrayUserProvider implements IdentityProviderInterface
{
    /** @var list<UserRecord> */
    private array $users;

    /** @param list<array<string,mixed>> $users */
    public function __construct(array $users)
    {
        $normalized = [];
        foreach ($users as $user) {
            if (!is_array($user)) {
                continue;
            }

            $id = trim((string)($user['id'] ?? ''));
            if ($id === '') {
                continue;
            }

            $passwordHash = password_hash((string)($user['password'] ?? ''), PASSWORD_ARGON2ID);

            $record = [
                'id' => $id,
                'password_hash' => $passwordHash,
                'roles' => array_values(array_filter((array)($user['roles'] ?? []), 'is_string')),
            ];

            $email = isset($user['email']) ? trim((string)$user['email']) : '';
            if ($email !== '') {
                $record['email'] = $email;
            }

            $username = isset($user['username']) ? trim((string)$user['username']) : '';
            if ($username !== '') {
                $record['username'] = $username;
            }

            $normalized[] = $record;
        }

        $this->users = $normalized;
    }

    public function validateCredentials(string $username, string $password): ?array
    {
        foreach ($this->users as $user) {
            $principal = $user['email'] ?? $user['username'] ?? null;
            if ($principal === $username && password_verify($password, $user['password_hash'])) {
                $identity = [
                    'id' => $user['id'],
                    'roles' => $user['roles'],
                ];
                if (isset($user['email'])) {
                    $identity['email'] = $user['email'];
                }
                return $identity;
            }
        }
        return null;
    }

    public function findById(string $id): ?array
    {
        foreach ($this->users as $user) {
            if ($user['id'] === $id) {
                $identity = [
                    'id' => $user['id'],
                    'roles' => $user['roles'],
                ];
                if (isset($user['email'])) {
                    $identity['email'] = $user['email'];
                }
                return $identity;
            }
        }
        return null;
    }

    public function claims(array $identity): array
    {
        return [
            'sub' => (string)($identity['id'] ?? ''),
            'email' => $identity['email'] ?? null,
            'roles' => $identity['roles'] ?? [],
        ];
    }

    /** @return array{id:string,email?:string,roles?:list<string>, ...}|null */
    public function findByEmail(string $email): ?array
    {
        foreach ($this->users as $user) {
            $userEmail = $user['email'] ?? null;
            if ($userEmail !== null && strcasecmp($userEmail, $email) === 0) {
                return [
                    'id' => $user['id'],
                    'email' => $userEmail,
                    'roles' => $user['roles'],
                ];
            }
        }
        return null;
    }
}
