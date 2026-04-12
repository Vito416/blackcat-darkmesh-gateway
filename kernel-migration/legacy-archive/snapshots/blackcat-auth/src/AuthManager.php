<?php
declare(strict_types=1);

namespace BlackCat\Auth;

use BlackCat\Auth\Config\AuthConfig;
use BlackCat\Auth\Identity\IdentityProviderInterface;
use BlackCat\Auth\Security\LoginLimiter;
use BlackCat\Auth\Security\TooManyAttemptsException;
use BlackCat\Auth\Token\TokenService;
use BlackCat\Auth\Token\TokenPair;
use BlackCat\Auth\Rbac\PolicyDecisionPoint;
use BlackCat\Auth\Rbac\RoleRegistry;
use BlackCat\Auth\Client\ClientRegistry;
use BlackCat\Auth\Middleware\AuthResult;
use BlackCat\Auth\Pkce\InMemoryPkceStore;
use BlackCat\Auth\Pkce\PkceHelper;
use BlackCat\Auth\Pkce\PkceSession;
use BlackCat\Auth\Pkce\PkceStoreInterface;
use BlackCat\Auth\MagicLink\MagicLinkService;
use BlackCat\Auth\Support\AuthEventHookInterface;
use BlackCat\Auth\Support\NullAuthEventHook;
use BlackCat\Sessions\SessionRecord;
use BlackCat\Sessions\SessionService;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

final class AuthManager
{
    private TokenService $tokens;
    private IdentityProviderInterface $provider;
    private PolicyDecisionPoint $pdp;
    private LoggerInterface $logger;
    private ClientRegistry $clients;
    private PkceStoreInterface $pkceStore;
    private AuthEventHookInterface $hook;
    private ?SessionService $sessions = null;
    private ?MagicLinkService $magicLinks = null;
    private int $pkceWindow;

    private function __construct(TokenService $tokens, IdentityProviderInterface $provider, PolicyDecisionPoint $pdp, ClientRegistry $clients, PkceStoreInterface $pkceStore, AuthEventHookInterface $hook, LoggerInterface $logger, int $pkceWindow)
    {
        $this->tokens = $tokens;
        $this->provider = $provider;
        $this->pdp = $pdp;
        $this->logger = $logger;
        $this->clients = $clients;
        $this->pkceStore = $pkceStore;
        $this->hook = $hook;
        $this->pkceWindow = $pkceWindow;
    }

    public static function boot(
        AuthConfig $config,
        IdentityProviderInterface $provider,
        ?LoggerInterface $logger = null,
        ?PkceStoreInterface $pkceStore = null,
        ?AuthEventHookInterface $hook = null,
        ?ClientRegistry $clients = null,
    ): self
    {
        $logger ??= new NullLogger();
        $roleRegistry = RoleRegistry::fromArray($config->roles());
        $pdp = new PolicyDecisionPoint($roleRegistry, $logger);
        $tokens = new TokenService($config, $logger);
        $clients ??= ClientRegistry::fromArray($config->clients());
        $pkceStore ??= new InMemoryPkceStore();
        $hook ??= new NullAuthEventHook();
        return new self($tokens, $provider, $pdp, $clients, $pkceStore, $hook, $logger, $config->pkceWindow());
    }

    public function issueTokens(string $username, string $password): TokenPair
    {
        return $this->passwordGrant($username, $password);
    }

    /**
     * @param array<string,mixed> $options
     */
    public function passwordGrant(string $username, string $password, array $options = []): TokenPair
    {
        $clientIp = (string)($options['client_ip'] ?? $options['ip'] ?? '');
        $clientIp = trim($clientIp) !== '' ? trim($clientIp) : null;

        try {
            if (LoginLimiter::isBlocked($clientIp)) {
                $retry = LoginLimiter::getSecondsUntilUnblock($clientIp);
                $this->hook->onFailure('password_grant', [
                    'username' => $username,
                    'reason' => 'rate_limited',
                    'retry_after' => $retry,
                ]);
                $this->logger->warning('auth.rate-limited', ['username' => $username, 'retry_after' => $retry]);
                throw new TooManyAttemptsException($retry);
            }
        } catch (TooManyAttemptsException $e) {
            throw $e;
        } catch (\Throwable) {
            // fail-open: limiter must never break auth
        }

        $identity = $this->provider->validateCredentials($username, $password);
        if ($identity === null) {
            try {
                LoginLimiter::registerAttempt($clientIp, false, null, $username);
            } catch (\Throwable) {
            }
            $this->hook->onFailure('password_grant', ['username' => $username, 'reason' => 'invalid_credentials']);
            $this->logger->warning('auth.invalid-credentials', ['username' => $username]);
            throw new \RuntimeException('Invalid credentials');
        }
        try {
            $userId = (int)$identity['id'];
            LoginLimiter::registerAttempt($clientIp, true, $userId > 0 ? $userId : null, $username);
        } catch (\Throwable) {
        }
        $claims = $this->provider->claims($identity);
        $this->hook->onSuccess('password_grant', ['username' => $username, 'subject' => $claims['sub'] ?? null]);
        return $this->tokens->issue($identity, $claims, $options);
    }

    /**
     * @return array<string,mixed>
     */
    public function verifyAccessToken(string $token): array
    {
        return $this->tokens->verify($token);
    }

    public function refresh(string $refreshToken): TokenPair
    {
        $claims = $this->tokens->verifyRefresh($refreshToken);
        $identity = $this->provider->findById($claims['sub']);
        if ($identity === null) {
            $this->hook->onFailure('refresh', ['subject' => $claims['sub'] ?? null, 'reason' => 'identity_missing']);
            throw new \RuntimeException('Identity not found');
        }
        $this->hook->onSuccess('refresh', ['subject' => $claims['sub']]);
        return $this->tokens->issue($identity, $this->provider->claims($identity));
    }

    /**
     * @param array<string,mixed> $claims
     */
    public function enforce(string $requiredRole, array $claims): void
    {
        if (!$this->pdp->allow($requiredRole, $claims)) {
            throw new \RuntimeException('Forbidden');
        }
    }

    public function middleware(): callable
    {
        return function (callable $next, array $request) {
            $authHeader = $request['headers']['Authorization'] ?? $request['headers']['authorization'] ?? '';
            if (!str_starts_with($authHeader, 'Bearer ')) {
                return new AuthResult(false, null, 'missing_token');
            }
            $token = substr($authHeader, 7);
            try {
                $claims = $this->verifyAccessToken($token);
                return $next($request, $claims);
            } catch (\Throwable $e) {
                return new AuthResult(false, null, $e->getMessage());
            }
        };
    }

    /**
     * @param list<string> $scopes
     */
    public function clientCredentials(string $clientId, string $clientSecret, array $scopes = []): TokenPair
    {
        $client = $this->clients->verify($clientId, $clientSecret);
        if ($client === null) {
            $this->hook->onFailure('client_credentials', ['client_id' => $clientId, 'reason' => 'invalid_client']);
            throw new \RuntimeException('invalid_client');
        }
        $scopes = $scopes ? array_values($scopes) : $client['scopes'];
        $claims = [
            'client_id' => $clientId,
            'roles' => $client['roles'],
            'scopes' => $scopes,
        ];
        $options = ['refresh' => false];
        if ($client['access_ttl'] ?? null) {
            $options['access_ttl'] = (int)$client['access_ttl'];
        }
        $pair = $this->tokens->issueForSubject('client:' . $clientId, $claims, $options);
        $this->hook->onSuccess('client_credentials', ['client_id' => $clientId, 'scopes' => $scopes]);
        return $pair;
    }

    /**
     * @param list<string> $scopes
     */
    public function initiatePkce(
        string $clientId,
        string $username,
        string $password,
        string $codeChallenge,
        string $method = 'S256',
        array $scopes = []
    ): string {
        if ($codeChallenge === '') {
            throw new \RuntimeException('missing_code_challenge');
        }
        if (!$this->clients->allowsPkce($clientId)) {
            $this->hook->onFailure('pkce_authorize', ['client_id' => $clientId, 'reason' => 'pkce_disabled']);
            throw new \RuntimeException('pkce_not_allowed');
        }

        try {
            if (LoginLimiter::isBlocked(null)) {
                $retry = LoginLimiter::getSecondsUntilUnblock(null);
                $this->hook->onFailure('pkce_authorize', [
                    'client_id' => $clientId,
                    'username' => $username,
                    'reason' => 'rate_limited',
                    'retry_after' => $retry,
                ]);
                throw new TooManyAttemptsException($retry);
            }
        } catch (TooManyAttemptsException $e) {
            throw $e;
        } catch (\Throwable) {
            // fail-open
        }

        $identity = $this->provider->validateCredentials($username, $password);
        if ($identity === null) {
            try {
                LoginLimiter::registerAttempt(null, false, null, $username);
            } catch (\Throwable) {
            }
            $this->hook->onFailure('pkce_authorize', ['client_id' => $clientId, 'username' => $username, 'reason' => 'invalid_credentials']);
            throw new \RuntimeException('Invalid credentials');
        }
        try {
            $userId = (int)$identity['id'];
            LoginLimiter::registerAttempt(null, true, $userId > 0 ? $userId : null, $username);
        } catch (\Throwable) {
        }
        $subjectId = (string)$identity['id'];
        if ($subjectId === '') {
            throw new \RuntimeException('missing_identity');
        }
        $session = PkceSession::issue($clientId, $subjectId, $codeChallenge, $method, array_values($scopes), $this->pkceWindow);
        $this->pkceStore->save($session);
        $this->hook->onSuccess('pkce_authorize', ['client_id' => $clientId, 'subject' => $subjectId]);
        return $session->code;
    }

    public function exchangePkce(string $clientId, string $code, string $codeVerifier): TokenPair
    {
        $session = $this->pkceStore->consume($code);
        if ($session === null || $session->clientId !== $clientId) {
            $this->hook->onFailure('pkce_exchange', ['client_id' => $clientId, 'reason' => 'invalid_code']);
            throw new \RuntimeException('invalid_code');
        }
        if (!PkceHelper::verify($session->codeChallenge, $codeVerifier, $session->method)) {
            $this->hook->onFailure('pkce_exchange', ['client_id' => $clientId, 'reason' => 'invalid_verifier']);
            throw new \RuntimeException('invalid_code_verifier');
        }
        $identity = $this->provider->findById($session->subjectId);
        if ($identity === null) {
            $this->hook->onFailure('pkce_exchange', ['client_id' => $clientId, 'reason' => 'identity_missing']);
            throw new \RuntimeException('identity_missing');
        }
        $claims = $this->provider->claims($identity);
        if ($session->scopes) {
            $claims['scopes'] = $session->scopes;
        }
        $this->hook->onSuccess('pkce_exchange', ['client_id' => $clientId, 'subject' => $claims['sub'] ?? null]);
        return $this->tokens->issue($identity, $claims, ['refresh' => true]);
    }

    public function withSessionService(SessionService $service): self
    {
        $clone = clone $this;
        $clone->sessions = $service;
        return $clone;
    }

    public function sessionService(): ?SessionService
    {
        return $this->sessions;
    }

    /**
     * @param array<string,mixed> $claims
     * @param array<string,mixed> $context
     */
    public function issueSession(array $claims, array $context = []): SessionRecord
    {
        if ($this->sessions === null) {
            throw new \RuntimeException('session_service_disabled');
        }
        return $this->sessions->issue($claims, $context);
    }

    public function hasClient(string $clientId): bool
    {
        return $this->clients->find($clientId) !== null;
    }

    public function withMagicLinkService(MagicLinkService $service): self
    {
        $clone = clone $this;
        $clone->magicLinks = $service;
        return $clone;
    }

    public function magicLinkService(): ?MagicLinkService
    {
        return $this->magicLinks;
    }

    /**
     * @return array<string,mixed>|null
     */
    public function findIdentityByEmail(string $email): ?array
    {
        if (method_exists($this->provider, 'lookupByEmail')) {
            $result = $this->provider->lookupByEmail($email);
            if (is_array($result)) {
                if (isset($result['user']) && is_array($result['user'])) {
                    return $result['user'];
                }
                if (isset($result['id'])) {
                    return $result;
                }
            }
        }
        if (method_exists($this->provider, 'findByEmail')) {
            /** @var callable $callable */
            $callable = [$this->provider, 'findByEmail'];
            $user = $callable($email);
            if (is_array($user)) {
                return $user;
            }
        }
        return null;
    }

    /**
     * @param array<string,mixed> $identity
     * @param array<string,mixed> $claimsOverride
     * @param array<string,mixed> $options
     */
    public function issueForIdentity(array $identity, array $claimsOverride = [], array $options = []): TokenPair
    {
        $claims = array_merge($this->provider->claims($identity), $claimsOverride);
        return $this->tokens->issue($identity, $claims, $options);
    }

    /**
     * @return array<string,mixed>|null
     */
    public function findIdentityById(string $id): ?array
    {
        return $this->provider->findById($id);
    }
}
