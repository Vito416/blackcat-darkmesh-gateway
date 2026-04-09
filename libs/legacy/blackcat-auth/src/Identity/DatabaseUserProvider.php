<?php
declare(strict_types=1);

namespace BlackCat\Auth\Identity;

use BlackCat\Core\Database;
use BlackCat\Auth\Password\PasswordHasher;
use BlackCat\Database\Packages\Users\Repository\UserRepository;

final class DatabaseUserProvider implements IdentityProviderInterface
{
    private readonly UserRepository $users;

    /**
     * @param array<string,mixed> $options
     */
    public function __construct(
        Database $db,
        private readonly PasswordHasher $hasher,
        private readonly EmailHasherInterface $emailHasher,
        private readonly array $options = []
    ) {
        $this->users = new UserRepository($db);
        $this->assertSupportedSchema();
    }

    /**
     * @return array{id:string,email?:string,roles?:list<string>, ...}|null
     */
    public function validateCredentials(string $username, string $password): ?array
    {
        $lookup = $this->lookupByEmailInternal($username, includePasswordHash: true);
        $user = $lookup['user'] ?? null;
        if ($user === null) {
            return null;
        }

        if (!$this->isActive($user)) {
            return null;
        }

        $idColumn = (string)($this->options['id_column'] ?? 'id');
        $idRaw = $user[$idColumn] ?? null;
        $id = is_scalar($idRaw) ? (string)$idRaw : '';
        if ($id === '') {
            return null;
        }

        $hashField = $this->options['password_column'] ?? 'password_hash';
        $versionField = $this->options['pepper_version_column'] ?? null;
        $storedHash = (string)($user[$hashField] ?? '');
        $version = $versionField ? ($user[$versionField] ?? null) : null;
        $result = $this->hasher->verify($password, $storedHash, $version ?: null);
        if (!$result->isValid()) {
            return null;
        }

        // Never propagate password hashes further in the auth pipeline.
        unset($user[$hashField]);

        // Attach the normalized email (not stored in DB) for immediate token issuance.
        $user['_email'] = $lookup['_normalized_email'] ?? null;
        $user['id'] = $id;

        return $user;
    }

    /**
     * @return array{id:string,email?:string,roles?:list<string>, ...}|null
     */
    public function findById(string $id): ?array
    {
        $user = $this->users->getById($id, false);
        if (!is_array($user) || !$this->isActive($user)) {
            return null;
        }

        $idColumn = (string)($this->options['id_column'] ?? 'id');
        $idRaw = $user[$idColumn] ?? null;
        $idStr = is_scalar($idRaw) ? (string)$idRaw : '';
        if ($idStr === '') {
            return null;
        }

        $hashField = $this->options['password_column'] ?? 'password_hash';
        unset($user[$hashField]);
        $user['id'] = $idStr;

        return $user;
    }

    /**
     * @param array<string,mixed> $identity
     * @return array<string,mixed>
     */
    public function claims(array $identity): array
    {
        $email = $identity['_email'] ?? ($identity[$this->options['email_column'] ?? 'email'] ?? null);

        return [
            'sub' => (string)$identity[$this->options['id_column'] ?? 'id'],
            'email' => is_string($email) && $email !== '' ? $email : null,
            'roles' => $this->extractRoles($identity),
        ];
    }

    /**
     * Lookup user by email and return metadata similar to legacy Auth::lookupUserByEmail.
     *
     * @return array{user:array<string,mixed>|null,usernameHashBinForAttempt:?string,matched_email_hash_version:?string,_normalized_email?:string|null}
     */
    public function lookupByEmail(string $email): array
    {
        return $this->lookupByEmailInternal($email, includePasswordHash: false);
    }

    /**
     * @return array{user:array<string,mixed>|null,usernameHashBinForAttempt:?string,matched_email_hash_version:?string,_normalized_email?:string|null}
     */
    private function lookupByEmailInternal(string $email, bool $includePasswordHash): array
    {
        $normalized = $this->emailHasher->normalize($email);
        $results = [
            'user' => null,
            'usernameHashBinForAttempt' => null,
            'matched_email_hash_version' => null,
            '_normalized_email' => $normalized,
        ];

        $hashColumn = (string)($this->options['email_hash_column'] ?? 'email_hash');
        if ($hashColumn !== 'email_hash') {
            return $results;
        }

        $user = $this->users->getByEmailHash($normalized, false);
        if (is_array($user)) {
            if (!$includePasswordHash) {
                $hashField = $this->options['password_column'] ?? 'password_hash';
                unset($user[$hashField]);
            }
            $results['user'] = $user;
        }
        return $results;
    }

    /**
     * @return array<string,mixed>|null
     */
    public function findByEmail(string $email): ?array
    {
        $lookup = $this->lookupByEmail($email);
        return $lookup['user'] ?? null;
    }

    /**
     * @param array<string,mixed> $user
     * @return list<string>
     */
    private function extractRoles(array $user): array
    {
        $key = $this->options['role_column'] ?? ($this->options['roles_column'] ?? 'actor_role');
        $raw = $user[$key] ?? null;
        if (is_string($raw)) {
            $json = json_decode($raw, true);
            if (is_array($json)) {
                return array_values(array_filter($json, 'is_string'));
            }
            if (str_contains($raw, ',')) {
                return array_values(array_filter(array_map('trim', explode(',', $raw)), 'is_string'));
            }
            return [$raw];
        }
        if (is_array($raw)) {
            return array_values(array_filter($raw, 'is_string'));
        }
        return [];
    }

    /**
     * @param array<string,mixed> $user
     */
    private function isActive(array $user): bool
    {
        $activeColumn = $this->options['active_column'] ?? null;
        $lockedColumn = $this->options['locked_column'] ?? null;

        if (is_string($activeColumn) && $activeColumn !== '' && empty($user[$activeColumn])) {
            return false;
        }
        if (is_string($lockedColumn) && $lockedColumn !== '' && !empty($user[$lockedColumn])) {
            return false;
        }
        return true;
    }

    private function assertSupportedSchema(): void
    {
        $expect = [
            'table' => 'users',
            'id_column' => 'id',
            'email_hash_column' => 'email_hash',
            'password_column' => 'password_hash',
            'pepper_version_column' => 'password_key_version',
            'role_column' => 'actor_role',
            'active_column' => 'is_active',
            'locked_column' => 'is_locked',
            'deleted_at_column' => 'deleted_at',
        ];

        foreach ($expect as $key => $expected) {
            if (!array_key_exists($key, $this->options)) {
                continue;
            }
            $actual = $this->options[$key];
            if ($actual === null || $actual === '') {
                continue;
            }
            if ((string)$actual !== (string)$expected) {
                throw new \InvalidArgumentException(
                    sprintf(
                        'DatabaseUserProvider expects blackcat-database users schema (%s=%s), got %s=%s.',
                        $key,
                        (string)$expected,
                        $key,
                        (string)$actual
                    )
                );
            }
        }
    }
}
