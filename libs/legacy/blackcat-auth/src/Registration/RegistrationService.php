<?php
declare(strict_types=1);

namespace BlackCat\Auth\Registration;

use BlackCat\Auth\Identity\EmailHasherInterface;
use BlackCat\Auth\Password\PasswordHasher;
use BlackCat\Core\Database;
use BlackCat\Database\Packages\Users\Repository\UserRepositoryInterface;

final class RegistrationService
{
    public function __construct(
        private readonly Database $db,
        private readonly UserRepositoryInterface $users,
        private readonly PasswordHasher $passwords,
        private readonly EmailHasherInterface $emails,
        private readonly EmailVerificationService $verifications,
        private readonly bool $requireEmailVerification = true,
        private readonly int $passwordMinLength = 8,
    ) {}

    /**
     * Register a user (revives soft-delete under the unique email_hash key).
     *
     * @return array{user_id:int,created:bool,verification_required:bool,verification_token:?string}
     */
    public function register(string $email, string $password): array
    {
        $normalized = $this->emails->normalize($email);
        if ($normalized === '' || !filter_var($normalized, FILTER_VALIDATE_EMAIL)) {
            throw new RegistrationException('invalid_email');
        }

        $min = max(1, $this->passwordMinLength);
        if (mb_strlen($password, 'UTF-8') < $min) {
            throw new RegistrationException('weak_password', 'password_min_length:' . $min);
        }

        $requireVerify = $this->requireEmailVerification;

        return $this->db->transaction(function () use ($normalized, $password, $requireVerify): array {
            $existing = $this->users->getByUnique(['email_hash' => $normalized]);
            if (is_array($existing) && isset($existing['id'])) {
                $userId = (int)$existing['id'];
                $isActive = !empty($existing['is_active']);

                $token = null;
                if ($requireVerify && !$isActive) {
                    $token = $this->verifications->issueForUserId($userId)->token();
                }

                return [
                    'user_id' => $userId,
                    'created' => false,
                    'verification_required' => $requireVerify,
                    'verification_token' => $token,
                ];
            }

            $hash = $this->passwords->hash($password);
            $algo = $this->passwords->algorithmName($hash);
            $pepperVersion = $this->passwords->currentPepperVersion();

            $row = [
                'email_hash' => $normalized,
                'password_hash' => $hash,
                'password_algo' => $algo,
                'password_key_version' => $pepperVersion,
                'is_active' => $requireVerify ? 0 : 1,
                'is_locked' => 0,
                'actor_role' => 'customer',
                'failed_logins' => 0,
                'must_change_password' => 0,
            ];

            // Use revive-mode upsert so "re-register" can safely revive soft-deleted identities.
            $this->users->upsertByKeysRevive($row, ['email_hash'], [
                'password_hash',
                'password_algo',
                'password_key_version',
                'is_active',
                'is_locked',
                'actor_role',
                'failed_logins',
                'must_change_password',
            ]);

            $saved = $this->users->getByUnique(['email_hash' => $normalized]);
            if (!is_array($saved) || !isset($saved['id'])) {
                throw new RegistrationException('registration_failed');
            }

            $userId = (int)$saved['id'];
            $token = null;
            if ($requireVerify) {
                $token = $this->verifications->issueForUserId($userId)->token();
            }

            return [
                'user_id' => $userId,
                'created' => true,
                'verification_required' => $requireVerify,
                'verification_token' => $token,
            ];
        });
    }

    /**
     * Issue a new email verification token (no-op when user doesn't exist or is already active).
     */
    public function resendVerification(string $email): ?string
    {
        $normalized = $this->emails->normalize($email);
        if ($normalized === '' || !filter_var($normalized, FILTER_VALIDATE_EMAIL)) {
            return null;
        }

        $row = $this->users->getByUnique(['email_hash' => $normalized]);
        if (!is_array($row) || !isset($row['id'])) {
            return null;
        }
        if (!empty($row['is_active'])) {
            return null;
        }

        $userId = (int)$row['id'];
        if ($userId <= 0) {
            return null;
        }

        return $this->verifications->issueForUserId($userId)->token();
    }
}
