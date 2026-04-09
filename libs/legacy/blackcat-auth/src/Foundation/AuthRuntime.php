<?php
declare(strict_types=1);

namespace BlackCat\Auth\Foundation;

use BlackCat\Auth\AuthManager;
use BlackCat\Auth\Config\AuthConfig;
use BlackCat\Auth\Config\FoundationConfig;
use BlackCat\Auth\DeviceCode\DatabaseDeviceCodeStore;
use BlackCat\Auth\DeviceCode\DeviceCodeService;
use BlackCat\Auth\Identity\PlainEmailHasher;
use BlackCat\Auth\MagicLink\DatabaseMagicLinkStore;
use BlackCat\Auth\MagicLink\MagicLinkDeliveryInterface;
use BlackCat\Auth\MagicLink\MagicLinkService;
use BlackCat\Auth\MagicLink\MailingMagicLinkDelivery;
use BlackCat\Auth\PasswordReset\MailingPasswordResetDelivery;
use BlackCat\Auth\PasswordReset\PasswordResetDeliveryInterface;
use BlackCat\Auth\PasswordReset\PasswordResetService;
use BlackCat\Auth\Registration\EmailVerificationDeliveryInterface;
use BlackCat\Auth\Registration\EmailVerificationService;
use BlackCat\Auth\Registration\MailingEmailVerificationDelivery;
use BlackCat\Auth\Registration\RegistrationService;
use BlackCat\Auth\Support\CompositeAuthHook;
use BlackCat\Auth\Support\TelemetryAuthHook;
use BlackCat\Auth\Telemetry\AuthTelemetry;
use BlackCat\Auth\WebAuthn\DatabaseWebAuthnStore;
use BlackCat\Auth\WebAuthn\WebAuthnService;
use BlackCat\Database\Packages\AuthEvents\AuthEventsModule;
use BlackCat\Database\Packages\DeviceCodes\DeviceCodesModule;
use BlackCat\Database\Packages\DeviceCodes\Repository\DeviceCodeRepository;
use BlackCat\Database\Packages\EmailVerifications\EmailVerificationsModule;
use BlackCat\Database\Packages\EmailVerifications\Repository\EmailVerificationRepository;
use BlackCat\Database\Packages\LoginAttempts\LoginAttemptsModule;
use BlackCat\Database\Packages\MagicLinks\MagicLinksModule;
use BlackCat\Database\Packages\MagicLinks\Repository\MagicLinkRepository;
use BlackCat\Database\Packages\Notifications\NotificationsModule;
use BlackCat\Database\Packages\Notifications\Repository\NotificationRepository;
use BlackCat\Database\Packages\PasswordResets\PasswordResetsModule;
use BlackCat\Database\Packages\PasswordResets\Repository\PasswordResetRepository;
use BlackCat\Database\Packages\RegisterEvents\RegisterEventsModule;
use BlackCat\Database\Packages\RateLimitCounters\RateLimitCountersModule;
use BlackCat\Database\Packages\Sessions\SessionsModule;
use BlackCat\Database\Packages\Tenants\Repository\TenantRepository;
use BlackCat\Database\Packages\Tenants\TenantsModule;
use BlackCat\Database\Packages\Users\Criteria as UsersCriteria;
use BlackCat\Database\Packages\Users\Dto\UserDto;
use BlackCat\Database\Packages\Users\Repository\UserRepository;
use BlackCat\Database\Packages\Users\UsersModule;
use BlackCat\Database\Packages\VerifyEvents\Repository\VerifyEventRepository;
use BlackCat\Database\Packages\VerifyEvents\VerifyEventsModule;
use BlackCat\Database\Packages\WebauthnChallenges\Repository\WebauthnChallengeRepository;
use BlackCat\Database\Packages\WebauthnChallenges\WebauthnChallengesModule;
use BlackCat\Database\Packages\WebauthnCredentials\Repository\WebauthnCredentialRepository;
use BlackCat\Database\Packages\WebauthnCredentials\WebauthnCredentialsModule;
use BlackCat\Mailing\Queue\FixedTenantResolver;
use BlackCat\Mailing\Queue\NotificationEnqueuer;
use BlackCat\Mailing\Queue\SlugTenantResolver;
use BlackCat\Mailing\Queue\TenantResolverInterface;
use BlackCat\Sessions\SessionService;
use BlackCat\Sessions\Store\InMemorySessionStore;
use BlackCat\Sessions\Store\SessionStoreFactory;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

final class AuthRuntime
{
    private AuthManager $auth;
    private LoggerInterface $logger;
    private AuthTelemetry $telemetry;
    private ?SessionService $sessions = null;
    private ?DeviceCodeService $deviceCodes = null;
    private ?MagicLinkService $magicLinks = null;
    private ?WebAuthnService $webauthn = null;
    private ?RegistrationService $registration = null;
    private ?EmailVerificationService $emailVerifications = null;
    private ?EmailVerificationDeliveryInterface $emailDelivery = null;
    private ?MagicLinkDeliveryInterface $magicLinkDelivery = null;
    private ?PasswordResetService $passwordResets = null;
    private ?PasswordResetDeliveryInterface $passwordResetDelivery = null;

    private function __construct(
        private readonly FoundationConfig $config,
        private readonly UserStoreInstance $store,
        ?LoggerInterface $logger = null
    ) {
        $this->logger = $logger ?? new NullLogger();
        $this->telemetry = new AuthTelemetry($config->telemetryFile());
        $this->auth = AuthManager::boot(
            $config->authConfig(),
            $store->provider(),
            $this->logger,
            null,
            new CompositeAuthHook(new TelemetryAuthHook($this->telemetry))
        );
    }

    public static function fromFile(string $path, ?LoggerInterface $logger = null): self
    {
        $config = FoundationConfig::fromFile($path);
        $store = UserStoreFactory::create($config->userStore());
        return new self($config, $store, $logger);
    }

    public function config(): FoundationConfig
    {
        return $this->config;
    }

    public function authConfig(): AuthConfig
    {
        return $this->config->authConfig();
    }

    public function auth(): AuthManager
    {
        return $this->auth;
    }

    public function userStore(): UserStoreInstance
    {
        return $this->store;
    }

    public function telemetry(): AuthTelemetry
    {
        return $this->telemetry;
    }

    public function sessionService(): ?SessionService
    {
        $ttl = $this->authConfig()->sessionTtl();
        if ($ttl === null || $ttl <= 0) {
            return null;
        }
        if ($this->sessions !== null) {
            return $this->sessions;
        }

        $storeConfig = $this->authConfig()->sessionStoreConfig();
        $db = $this->store->db();
        $storeType = strtolower((string)($storeConfig['type'] ?? 'memory'));

        if (in_array($storeType, ['database', 'db'], true) && $db !== null) {
            $this->ensureUserStoreSchema();
            (new SessionsModule())->install($db, $db->dialect());
        }

        $store = $storeConfig !== []
            ? SessionStoreFactory::fromConfig($storeConfig, $db)
            : new InMemorySessionStore();

        $this->sessions = new SessionService($store, $ttl);
        if ($this->auth->sessionService() === null) {
            $this->auth = $this->auth->withSessionService($this->sessions);
        }

        return $this->sessions;
    }

    public function deviceCodeService(): ?DeviceCodeService
    {
        $db = $this->store->db();
        if ($db === null) {
            return null;
        }
        if ($this->deviceCodes !== null) {
            return $this->deviceCodes;
        }

        $this->ensureUserStoreSchema();
        (new DeviceCodesModule())->install($db, $db->dialect());

        $this->deviceCodes = new DeviceCodeService(
            new DatabaseDeviceCodeStore($db, new DeviceCodeRepository($db)),
            rtrim($this->authConfig()->publicBaseUrl(), '/') . '/device/activate',
        );

        return $this->deviceCodes;
    }

    public function magicLinkService(): ?MagicLinkService
    {
        $ttl = $this->authConfig()->magicLinkTtl();
        if ($ttl === null || $ttl <= 0) {
            return null;
        }

        $db = $this->store->db();
        if ($db === null) {
            return null;
        }
        if ($this->magicLinks !== null) {
            return $this->magicLinks;
        }

        $this->ensureUserStoreSchema();
        (new MagicLinksModule())->install($db, $db->dialect());

        $this->magicLinks = new MagicLinkService(
            new DatabaseMagicLinkStore($db, new MagicLinkRepository($db)),
            $ttl,
            $this->authConfig()->magicLinkUrl(),
            $this->authConfig()->signingKey()
        );

        if ($this->auth->magicLinkService() === null) {
            $this->auth = $this->auth->withMagicLinkService($this->magicLinks);
        }

        return $this->magicLinks;
    }

    public function webauthnService(): ?WebAuthnService
    {
        $rpId = $this->authConfig()->webauthnRpId();
        if ($rpId === null || $rpId === '') {
            return null;
        }

        $db = $this->store->db();
        if ($db === null) {
            return null;
        }
        if ($this->webauthn !== null) {
            return $this->webauthn;
        }

        $this->ensureUserStoreSchema();
        (new WebauthnCredentialsModule())->install($db, $db->dialect());
        (new WebauthnChallengesModule())->install($db, $db->dialect());

        $store = new DatabaseWebAuthnStore(
            $db,
            $rpId,
            new WebauthnCredentialRepository($db),
            new WebauthnChallengeRepository($db),
            $this->authConfig()->webauthnChallengeTtlSec(),
        );

        $this->webauthn = new WebAuthnService(
            $store,
            $rpId,
            $this->authConfig()->webauthnRpName() ?? 'BlackCat Auth'
        );

        return $this->webauthn;
    }

    public function ensureUserStoreSchema(): void
    {
        $db = $this->store->db();
        if ($db === null) {
            return;
        }
        $dialect = $db->dialect();

        (new UsersModule())->install($db, $dialect);
        (new AuthEventsModule())->install($db, $dialect);
        (new RateLimitCountersModule())->install($db, $dialect);
        (new LoginAttemptsModule())->install($db, $dialect);
        (new RegisterEventsModule())->install($db, $dialect);
        (new EmailVerificationsModule())->install($db, $dialect);
        (new VerifyEventsModule())->install($db, $dialect);
        (new PasswordResetsModule())->install($db, $dialect);

        if ($this->authConfig()->requireEmailVerification() || $this->isMailingEnabled()) {
            (new TenantsModule())->install($db, $dialect);
            (new NotificationsModule())->install($db, $dialect);
        }
    }

    /**
     * @return list<string>
     */
    public function seedUsers(bool $force = false): array
    {
        $db = $this->store->db();
        $hasher = $this->store->hasher();
        if ($db === null || $hasher === null) {
            return [];
        }

        $this->ensureUserStoreSchema();
        $repo = new UserRepository($db);
        $emailHasher = new PlainEmailHasher();

        $inserted = [];
        foreach ($this->config->seedUsers() as $user) {
            $email = $emailHasher->normalize((string)($user['email'] ?? ''));
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                continue;
            }
            $existing = $repo->getByUnique(['email_hash' => $email]);
            if ($existing && !$force) {
                continue;
            }

            $password = (string)($user['password'] ?? 'secret');
            $hash = $hasher->hash($password);
            $algo = $hasher->algorithmName($hash);
            $pepperVersion = $hasher->currentPepperVersion();

            $roles = (array)($user['roles'] ?? []);
            $role = in_array('admin', $roles, true) ? 'admin' : 'customer';

            $row = [
                'email_hash' => $email,
                'password_hash' => $hash,
                'password_algo' => $algo,
                'password_key_version' => $pepperVersion,
                'is_active' => true,
                'is_locked' => false,
                'actor_role' => $role,
            ];

            // Always use revive-mode upsert: it handles soft-deleted rows under the unique email_hash key.
            $repo->upsertByKeysRevive($row, ['email_hash'], [
                'password_hash',
                'password_algo',
                'password_key_version',
                'is_active',
                'is_locked',
                'actor_role',
            ]);

            $saved = $repo->getByUnique(['email_hash' => $email]);
            $id = null;
            if ($saved instanceof UserDto) {
                $id = (string)$saved->id;
            } elseif (is_array($saved) && isset($saved['id'])) {
                $id = (string)$saved['id'];
            } elseif ($existing instanceof UserDto) {
                $id = (string)$existing->id;
            } elseif (is_array($existing) && isset($existing['id'])) {
                $id = (string)$existing['id'];
            }

            if ($id !== null && $id !== '') {
                $inserted[] = $id;
            }
        }
        return $inserted;
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function listUsers(int $limit = 20): array
    {
        $db = $this->store->db();
        if ($db === null) {
            return $this->config->seedUsers();
        }

        $this->ensureUserStoreSchema();
        $repo = new UserRepository($db);
        $criteria = UsersCriteria::fromDb($db)
            ->orderBy('created_at', 'DESC')
            ->setPerPage(max(1, $limit))
            ->setPage(1);
        $page = $repo->paginate($criteria);
        $rows = $page['items'];

        $out = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $role = (string)($row['actor_role'] ?? '');
            $out[] = [
                'id' => $row['id'] ?? null,
                'email_hash' => $row['email_hash_hex'] ?? null,
                'roles' => $role !== '' ? [$role] : [],
                'is_active' => (bool)($row['is_active'] ?? false),
                'is_locked' => (bool)($row['is_locked'] ?? false),
                'created_at' => $row['created_at'] ?? null,
            ];
        }
        return $out;
    }

    /**
     * @return array<string,mixed>
     */
    public function healthReport(): array
    {
        $db = $this->store->db();
        $report = [
            'config' => $this->config->path(),
            'signing_key_length' => strlen($this->authConfig()->signingKey()),
            'telemetry' => $this->config->telemetryFile() ? 'configured' : 'disabled',
            'user_store_driver' => $db ? 'database' : 'array',
        ];
        if ($db) {
            $report['database'] = $this->ping($db);
        }
        return $report;
    }

    private function ping(\BlackCat\Core\Database $db): string
    {
        try {
            return $db->ping() ? 'ok' : 'error';
        } catch (\Throwable $e) {
            return 'error: ' . $e->getMessage();
        }
    }

    public function emailVerificationService(): ?EmailVerificationService
    {
        $db = $this->store->db();
        if ($db === null) {
            return null;
        }
        if ($this->emailVerifications !== null) {
            return $this->emailVerifications;
        }

        $this->ensureUserStoreSchema();

        $this->emailVerifications = new EmailVerificationService(
            $db,
            new EmailVerificationRepository($db),
            new UserRepository($db),
            new VerifyEventRepository($db),
            $this->authConfig()->emailVerificationTtl(),
        );
        return $this->emailVerifications;
    }

    public function registrationService(): ?RegistrationService
    {
        $db = $this->store->db();
        $hasher = $this->store->hasher();
        if ($db === null || $hasher === null) {
            return null;
        }
        if ($this->registration !== null) {
            return $this->registration;
        }

        $verifications = $this->emailVerificationService();
        if ($verifications === null) {
            return null;
        }

        $this->registration = new RegistrationService(
            $db,
            new UserRepository($db),
            $hasher,
            new PlainEmailHasher(),
            $verifications,
            $this->authConfig()->requireEmailVerification(),
            $this->authConfig()->passwordMinLength(),
        );
        return $this->registration;
    }

    public function passwordResetService(): ?PasswordResetService
    {
        $db = $this->store->db();
        $hasher = $this->store->hasher();
        if ($db === null || $hasher === null) {
            return null;
        }
        if ($this->passwordResets !== null) {
            return $this->passwordResets;
        }

        $this->ensureUserStoreSchema();

        $this->passwordResets = new PasswordResetService(
            $db,
            new PasswordResetRepository($db),
            new UserRepository($db),
            $hasher,
            new PlainEmailHasher(),
            $this->authConfig()->passwordResetTtl(),
            $this->authConfig()->passwordMinLength(),
        );
        return $this->passwordResets;
    }

    public function emailVerificationDelivery(): ?EmailVerificationDeliveryInterface
    {
        $db = $this->store->db();
        if ($db === null) {
            return null;
        }
        if (!$this->authConfig()->requireEmailVerification()) {
            return null;
        }
        if ($this->emailDelivery !== null) {
            return $this->emailDelivery;
        }

        $this->ensureUserStoreSchema();

        if (!$this->isMailingEnabled()) {
            return null;
        }

        $mailing = $this->config->mailing();

        $template = trim((string)($mailing['verify_email_template'] ?? 'verify_email'));
        if ($template === '') {
            $template = 'verify_email';
        }
        $priority = (int)($mailing['verify_email_priority'] ?? 10);
        $appName = trim((string)($mailing['app_name'] ?? $this->authConfig()->issuer()));
        if ($appName === '') {
            $appName = 'BlackCat';
        }

        $tenantResolver = $this->buildTenantResolver($mailing, $db);
        $queue = new NotificationEnqueuer($db, new NotificationRepository($db), $tenantResolver);

        $this->emailDelivery = new MailingEmailVerificationDelivery($queue, $template, $priority, $appName);
        return $this->emailDelivery;
    }

    public function passwordResetDelivery(): ?PasswordResetDeliveryInterface
    {
        $db = $this->store->db();
        if ($db === null) {
            return null;
        }
        if ($this->passwordResetDelivery !== null) {
            return $this->passwordResetDelivery;
        }
        if (!$this->isMailingEnabled()) {
            return null;
        }

        $this->ensureUserStoreSchema();

        $mailing = $this->config->mailing();

        $template = trim((string)($mailing['reset_password_template'] ?? 'reset_password'));
        if ($template === '') {
            $template = 'reset_password';
        }
        $priority = (int)($mailing['reset_password_priority'] ?? 10);
        $appName = trim((string)($mailing['app_name'] ?? $this->authConfig()->issuer()));
        if ($appName === '') {
            $appName = 'BlackCat';
        }

        $tenantResolver = $this->buildTenantResolver($mailing, $db);
        $queue = new NotificationEnqueuer($db, new NotificationRepository($db), $tenantResolver);

        $this->passwordResetDelivery = new MailingPasswordResetDelivery($queue, $template, $priority, $appName);
        return $this->passwordResetDelivery;
    }

    public function magicLinkDelivery(): ?MagicLinkDeliveryInterface
    {
        $ttl = $this->authConfig()->magicLinkTtl();
        if ($ttl === null || $ttl <= 0) {
            return null;
        }

        $db = $this->store->db();
        if ($db === null) {
            return null;
        }
        if ($this->magicLinkDelivery !== null) {
            return $this->magicLinkDelivery;
        }
        if (!$this->isMailingEnabled()) {
            return null;
        }

        $this->ensureUserStoreSchema();

        $mailing = $this->config->mailing();

        $template = trim((string)($mailing['magic_link_template'] ?? 'magic_link'));
        if ($template === '') {
            $template = 'magic_link';
        }
        $priority = (int)($mailing['magic_link_priority'] ?? 10);
        $appName = trim((string)($mailing['app_name'] ?? $this->authConfig()->issuer()));
        if ($appName === '') {
            $appName = 'BlackCat';
        }

        $tenantResolver = $this->buildTenantResolver($mailing, $db);
        $queue = new NotificationEnqueuer($db, new NotificationRepository($db), $tenantResolver);

        $this->magicLinkDelivery = new MailingMagicLinkDelivery($queue, $template, $priority, $appName);
        return $this->magicLinkDelivery;
    }

    /**
     * @param array<string,mixed> $mailing
     */
    private function buildTenantResolver(array $mailing, \BlackCat\Core\Database $db): TenantResolverInterface
    {
        $tenantId = isset($mailing['tenant_id']) ? (int)$mailing['tenant_id'] : 0;
        if ($tenantId > 0) {
            return new FixedTenantResolver($tenantId);
        }

        $tenant = $mailing['tenant'] ?? [];
        $tenant = is_array($tenant) ? $tenant : [];

        $slug = trim((string)($tenant['slug'] ?? 'default'));
        if ($slug === '') {
            $slug = 'default';
        }
        $name = trim((string)($tenant['name'] ?? 'Default tenant'));
        if ($name === '') {
            $name = 'Default tenant';
        }
        $autoCreate = array_key_exists('auto_create', $tenant) ? (bool)$tenant['auto_create'] : true;

        return new SlugTenantResolver(new TenantRepository($db), $slug, $name, $autoCreate);
    }

    private function isMailingEnabled(): bool
    {
        $mailing = $this->config->mailing();
        return array_key_exists('enabled', $mailing) ? (bool)$mailing['enabled'] : true;
    }
}
