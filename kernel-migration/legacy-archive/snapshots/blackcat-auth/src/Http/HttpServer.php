<?php
declare(strict_types=1);

namespace BlackCat\Auth\Http;

use BlackCat\Auth\AuthManager;
use BlackCat\Auth\Config\AuthConfig;
use BlackCat\Auth\Identity\IdentityProviderInterface;
use BlackCat\Auth\Token\TokenPair;
use BlackCat\Auth\Support\JwksProvider;
use BlackCat\Auth\Support\OidcMetadataBuilder;
use BlackCat\Auth\DeviceCode\DeviceCodeService;
use BlackCat\Auth\DeviceCode\InMemoryDeviceCodeStore;
use BlackCat\Auth\MagicLink\MagicLinkService;
use BlackCat\Auth\MagicLink\InMemoryMagicLinkStore;
use BlackCat\Auth\MagicLink\MagicLinkDeliveryInterface;
use BlackCat\Auth\WebAuthn\WebAuthnService;
use BlackCat\Auth\WebAuthn\InMemoryWebAuthnStore;
use BlackCat\Auth\Support\CompositeAuthHook;
use BlackCat\Auth\Support\EventBuffer;
use BlackCat\Auth\Support\StreamingAuthHook;
use BlackCat\Auth\Support\TelemetryAuthHook;
use BlackCat\Auth\Support\WebhookEventHook;
use BlackCat\Auth\PasswordReset\PasswordResetDeliveryInterface;
use BlackCat\Auth\PasswordReset\PasswordResetException;
use BlackCat\Auth\PasswordReset\PasswordResetService;
use BlackCat\Auth\Registration\EmailVerificationDeliveryInterface;
use BlackCat\Auth\Registration\EmailVerificationException;
use BlackCat\Auth\Registration\EmailVerificationService;
use BlackCat\Auth\Registration\RegistrationException;
use BlackCat\Auth\Registration\RegistrationService;
use BlackCat\Auth\Security\LoginLimiter;
use BlackCat\Auth\Security\MagicLinkLimiter;
use BlackCat\Auth\Security\PasswordResetLimiter;
use BlackCat\Auth\Security\AuthAudit;
use BlackCat\Auth\Security\TooManyAttemptsException;
use BlackCat\Auth\Security\VerifyEmailResendLimiter;
use BlackCat\Auth\Telemetry\AuthTelemetry;
use BlackCat\Sessions\SessionService;
use BlackCat\Sessions\Store\InMemorySessionStore;
use BlackCat\Sessions\Store\SessionStoreFactory;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * Minimal HTTP handler used by `bin/auth-http`.
 *
 * @phpstan-type HttpRequest array{method:string,path:string,query:array<string,string>,headers:array<string,string>,body:array<string,mixed>}
 * @phpstan-type HttpResponse array{status:int,body:mixed,headers?:list<string>}
 * @phpstan-type Claims array<string,mixed>
 */
final class HttpServer
{
    public function __construct(
        private readonly AuthManager $auth,
        private readonly AuthConfig $config,
        private readonly LoggerInterface $logger = new NullLogger(),
        private readonly ?DeviceCodeService $deviceCodes = null,
        private readonly ?MagicLinkService $magicLinks = null,
        private readonly ?WebAuthnService $webauthn = null,
        private readonly ?EventBuffer $events = null,
        private readonly ?RegistrationService $registration = null,
        private readonly ?EmailVerificationService $emailVerifications = null,
        private readonly ?EmailVerificationDeliveryInterface $emailDelivery = null,
        private readonly ?PasswordResetService $passwordResets = null,
        private readonly ?PasswordResetDeliveryInterface $passwordResetDelivery = null,
        private readonly ?MagicLinkDeliveryInterface $magicLinkDelivery = null,
    ) {}

    public static function bootstrap(
        AuthConfig $config,
        IdentityProviderInterface $provider,
        ?LoggerInterface $logger = null,
        ?SessionService $sessionService = null,
        ?DeviceCodeService $deviceCodeService = null,
        ?MagicLinkService $magicLinkService = null,
        ?WebAuthnService $webauthnService = null,
        ?AuthTelemetry $telemetry = null,
        ?RegistrationService $registrationService = null,
        ?EmailVerificationService $emailVerificationService = null,
        ?EmailVerificationDeliveryInterface $emailVerificationDelivery = null,
        ?PasswordResetService $passwordResetService = null,
        ?PasswordResetDeliveryInterface $passwordResetDelivery = null,
        ?MagicLinkDeliveryInterface $magicLinkDelivery = null,
    ): self {
        $eventsBuffer = new EventBuffer($config->eventsBufferSize());
        $hooks = [];
        $telemetry ??= new AuthTelemetry(null);
        $hooks[] = new TelemetryAuthHook($telemetry);
        $hooks[] = new StreamingAuthHook(fn(string $event, array $payload) => $eventsBuffer->push($event, $payload));
        if ($config->eventWebhooks()) {
            $hooks[] = new WebhookEventHook($config->eventWebhooks());
        }
        $hook = new CompositeAuthHook(...$hooks);
        $auth = AuthManager::boot($config, $provider, $logger, null, $hook);
        if ($sessionService === null && $config->sessionTtl()) {
            $storeConfig = $config->sessionStoreConfig();
            $store = $storeConfig ? SessionStoreFactory::fromConfig($storeConfig) : new InMemorySessionStore();
            $sessionService = new SessionService($store, $config->sessionTtl());
        }
        if ($sessionService) {
            $auth = $auth->withSessionService($sessionService);
        }
        if ($magicLinkService === null && $config->magicLinkTtl()) {
            $magicLinkService = new MagicLinkService(
                new InMemoryMagicLinkStore(),
                $config->magicLinkTtl(),
                $config->magicLinkUrl(),
                $config->signingKey()
            );
        }
        if ($magicLinkService) {
            $auth = $auth->withMagicLinkService($magicLinkService);
        }
        $webauthnService ??= $config->webauthnRpId()
            ? new WebAuthnService(
                new InMemoryWebAuthnStore(),
                $config->webauthnRpId(),
                $config->webauthnRpName() ?? 'BlackCat Auth'
            )
            : null;
        $deviceCodeService ??= new DeviceCodeService(
            new InMemoryDeviceCodeStore(),
            rtrim($config->publicBaseUrl(), '/') . '/device/activate'
        );
        return new self(
            auth: $auth,
            config: $config,
            logger: $logger ?? new NullLogger(),
            deviceCodes: $deviceCodeService,
            magicLinks: $magicLinkService,
            webauthn: $webauthnService,
            events: $eventsBuffer,
            registration: $registrationService,
            emailVerifications: $emailVerificationService,
            emailDelivery: $emailVerificationDelivery,
            passwordResets: $passwordResetService,
            passwordResetDelivery: $passwordResetDelivery,
            magicLinkDelivery: $magicLinkDelivery,
        );
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    public function handle(array $request): array
    {
        $path = $request['path'];
        return match ($path) {
            '/login' => $this->login($request),
            '/register' => $this->register($request),
            '/refresh' => $this->refresh($request),
            '/introspect' => $this->introspect($request),
            '/jwks.json' => ['status' => 200, 'body' => JwksProvider::fromConfig($this->config)],
            '/.well-known/openid-configuration' => ['status' => 200, 'body' => OidcMetadataBuilder::build($this->config)],
            '/.well-known/oauth-authorization-server' => ['status' => 200, 'body' => OidcMetadataBuilder::build($this->config)],
            '/userinfo' => $this->userinfo($request),
            '/authorize' => $this->authorize($request),
            '/token' => $this->token($request),
            '/verify-email' => $this->verifyEmail($request),
            '/verify-email/resend' => $this->verifyEmailResend($request),
            '/password-reset/request' => $this->passwordResetRequest($request),
            '/password-reset/confirm' => $this->passwordResetConfirm($request),
            '/session' => $this->handleSessionCollection($request),
            '/device/code' => $this->deviceCodeIssue($request),
            '/device/activate' => $this->deviceCodeActivate($request),
            '/device/token' => $this->deviceCodePoll($request),
            '/magic-link/request' => $this->magicLinkRequest($request),
            '/magic-link/consume' => $this->magicLinkConsume($request),
            '/webauthn/register/start' => $this->webauthnRegisterStart($request),
            '/webauthn/register/finish' => $this->webauthnRegisterFinish($request),
            '/webauthn/authenticate/start' => $this->webauthnAuthStart($request),
            '/webauthn/authenticate/finish' => $this->webauthnAuthFinish($request),
            '/events/stream' => $this->eventsStream($request),
            '/healthz' => ['status' => 200, 'body' => ['status' => 'ok']],
            default => $this->handleDynamicRoutes($path, $request),
        };
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function login(array $request): array
    {
        $body = $request['body'];
        $email = (string)($body['username'] ?? '');
        $password = (string)($body['password'] ?? '');
        try {
            $tokens = $this->auth->issueTokens($email, $password);
            return ['status' => 200, 'body' => $this->formatPair($tokens)];
        } catch (TooManyAttemptsException $e) {
            $headers = [];
            if ($e->retryAfterSeconds > 0) {
                $headers[] = 'Retry-After: ' . (string)$e->retryAfterSeconds;
            }
            return [
                'status' => 429,
                'headers' => $headers,
                'body' => ['error' => 'too_many_attempts', 'retry_after' => $e->retryAfterSeconds],
            ];
        } catch (\Throwable $e) {
            return ['status' => 401, 'body' => ['error' => 'invalid_credentials']];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function register(array $request): array
    {
        if ($this->registration === null) {
            return ['status' => 501, 'body' => ['error' => 'registration_disabled']];
        }

        $method = strtoupper($request['method']);
        if ($method !== 'POST') {
            return ['status' => 405, 'body' => ['error' => 'method_not_allowed']];
        }

        try {
            if (LoginLimiter::isRegisterBlocked(null)) {
                $retry = LoginLimiter::getRegisterSecondsUntilUnblock(null);
                throw new TooManyAttemptsException($retry);
            }
        } catch (TooManyAttemptsException $e) {
            $headers = [];
            if ($e->retryAfterSeconds > 0) {
                $headers[] = 'Retry-After: ' . (string)$e->retryAfterSeconds;
            }
            return [
                'status' => 429,
                'headers' => $headers,
                'body' => ['error' => 'too_many_attempts', 'retry_after' => $e->retryAfterSeconds],
            ];
        } catch (\Throwable) {
            // fail-open
        }

        $body = $request['body'];
        $email = (string)($body['email'] ?? ($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $headers = $request['headers'];
        $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');

        try {
            $result = $this->registration->register($email, $password);
            try {
                LoginLimiter::registerRegisterAttempt(true, (int)$result['user_id'], $userAgent ?: null, [
                    'created' => (bool)$result['created'],
                ]);
            } catch (\Throwable) {
            }

            $payload = [
                'status' => 'ok',
                'verification_required' => (bool)$result['verification_required'],
            ];

            $token = $result['verification_token'];
            if (
                (bool)$payload['verification_required']
                && is_string($token)
                && $token !== ''
                && $this->emailDelivery !== null
            ) {
                $link = $this->buildVerificationLink($token);
                if ($link !== null) {
                    try {
                        $this->emailDelivery->queueVerificationEmail(
                            $email,
                            (int)$result['user_id'],
                            $token,
                            $link,
                            $this->config->emailVerificationTtl(),
                        );
                        $payload['email_queued'] = true;
                    } catch (\Throwable $e) {
                        $this->logger->warning('email_verification_enqueue_failed', ['error' => $e->getMessage()]);
                        $payload['email_queued'] = false;
                    }
                }
            }
            if ($this->config->devReturnVerificationToken() && is_string($token) && $token !== '') {
                $payload['verification_token'] = $token;
                $link = $this->buildVerificationLink($token);
                if ($link !== null) {
                    $payload['verification_link'] = $link;
                }
            }

            return ['status' => 201, 'body' => $payload];
        } catch (RegistrationException $e) {
            try {
                LoginLimiter::registerRegisterAttempt(false, null, $userAgent ?: null, null, $e->reason);
            } catch (\Throwable) {
            }
            return ['status' => 400, 'body' => ['error' => $e->reason]];
        } catch (\Throwable $e) {
            try {
                LoginLimiter::registerRegisterAttempt(false, null, $userAgent ?: null, null, 'registration_failed');
            } catch (\Throwable) {
            }
            return ['status' => 400, 'body' => ['error' => 'registration_failed']];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function refresh(array $request): array
    {
        $body = $request['body'];
        $token = (string)($body['refresh_token'] ?? '');
        try {
            $tokens = $this->auth->refresh($token);
            return ['status' => 200, 'body' => $this->formatPair($tokens)];
        } catch (\Throwable $e) {
            return ['status' => 401, 'body' => ['error' => $e->getMessage()]];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function introspect(array $request): array
    {
        $body = $request['body'];
        $token = (string)($body['token'] ?? '');
        try {
            $claims = $this->auth->verifyAccessToken($token);
            return ['status' => 200, 'body' => ['active' => true, 'claims' => $claims]];
        } catch (\Throwable $e) {
            return ['status' => 200, 'body' => ['active' => false, 'error' => $e->getMessage()]];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function authorize(array $request): array
    {
        $body = $request['body'];
        $scopes = array_values(array_filter((array)($body['scopes'] ?? []), 'is_string'));
        try {
            $code = $this->auth->initiatePkce(
                (string)($body['client_id'] ?? ''),
                (string)($body['username'] ?? ''),
                (string)($body['password'] ?? ''),
                (string)($body['code_challenge'] ?? ''),
                (string)($body['code_challenge_method'] ?? 'S256'),
                $scopes
            );
            return ['status' => 200, 'body' => ['code' => $code]];
        } catch (TooManyAttemptsException $e) {
            $headers = [];
            if ($e->retryAfterSeconds > 0) {
                $headers[] = 'Retry-After: ' . (string)$e->retryAfterSeconds;
            }
            return [
                'status' => 429,
                'headers' => $headers,
                'body' => ['error' => 'too_many_attempts', 'retry_after' => $e->retryAfterSeconds],
            ];
        } catch (\Throwable $e) {
            return ['status' => 400, 'body' => ['error' => $e->getMessage()]];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function token(array $request): array
    {
        $body = $request['body'];
        $grant = strtolower((string)($body['grant_type'] ?? 'password'));
        try {
            return match ($grant) {
                'password' => ['status' => 200, 'body' => $this->formatPair(
                    $this->auth->passwordGrant(
                        (string)($body['username'] ?? ''),
                        (string)($body['password'] ?? ''),
                        []
                    )
                )],
                'refresh_token' => ['status' => 200, 'body' => $this->formatPair(
                    $this->auth->refresh((string)($body['refresh_token'] ?? ''))
                )],
                'client_credentials' => ['status' => 200, 'body' => $this->formatPair(
                    $this->auth->clientCredentials(
                        (string)($body['client_id'] ?? ''),
                        (string)($body['client_secret'] ?? ''),
                        array_values(array_filter((array)($body['scopes'] ?? []), 'is_string'))
                    )
                )],
                'authorization_code' => ['status' => 200, 'body' => $this->formatPair(
                    $this->auth->exchangePkce(
                        (string)($body['client_id'] ?? ''),
                        (string)($body['code'] ?? ''),
                        (string)($body['code_verifier'] ?? '')
                    )
                )],
                default => ['status' => 400, 'body' => ['error' => 'unsupported_grant_type']],
            };
        } catch (TooManyAttemptsException $e) {
            $headers = [];
            if ($e->retryAfterSeconds > 0) {
                $headers[] = 'Retry-After: ' . (string)$e->retryAfterSeconds;
            }
            return [
                'status' => 429,
                'headers' => $headers,
                'body' => ['error' => 'too_many_attempts', 'retry_after' => $e->retryAfterSeconds],
            ];
        } catch (\Throwable $e) {
            return ['status' => 400, 'body' => ['error' => $e->getMessage()]];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function verifyEmail(array $request): array
    {
        if ($this->emailVerifications === null) {
            return ['status' => 501, 'body' => ['error' => 'email_verification_disabled']];
        }

        $method = strtoupper($request['method']);
        if ($method !== 'POST') {
            return ['status' => 405, 'body' => ['error' => 'method_not_allowed']];
        }

        $body = $request['body'];
        $token = (string)($body['token'] ?? ($body['verification_token'] ?? ''));
        if (trim($token) === '') {
            return ['status' => 400, 'body' => ['error' => 'missing_token']];
        }

        $headers = $request['headers'];
        $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');

        try {
            $userId = $this->emailVerifications->verifyAndActivate($token, null, $userAgent ?: null, ['purpose' => 'email']);
            $identity = $this->auth->findIdentityById((string)$userId);
            if ($identity === null) {
                return ['status' => 404, 'body' => ['error' => 'user_not_found']];
            }
            $pair = $this->auth->issueForIdentity($identity);
            return ['status' => 200, 'body' => $this->formatPair($pair)];
        } catch (EmailVerificationException $e) {
            $status = match ($e->reason) {
                'user_not_found' => 404,
                default => 400,
            };
            return ['status' => $status, 'body' => ['error' => $e->reason]];
        } catch (\Throwable) {
            return ['status' => 400, 'body' => ['error' => 'invalid_token']];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function verifyEmailResend(array $request): array
    {
        if ($this->registration === null) {
            return ['status' => 501, 'body' => ['error' => 'registration_disabled']];
        }

        $method = strtoupper($request['method']);
        if ($method !== 'POST') {
            return ['status' => 405, 'body' => ['error' => 'method_not_allowed']];
        }

        $body = $request['body'];
        $email = (string)($body['email'] ?? ($body['username'] ?? ''));
        if (trim($email) === '') {
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }
        $headers = $request['headers'];
        $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');

        // Throttle must be non-enumerating: applied before user lookup.
        try {
            VerifyEmailResendLimiter::assertAllowed(
                null,
                $email,
                $this->config->verifyEmailResendThrottleMaxPerIp(),
                $this->config->verifyEmailResendThrottleMaxPerEmail(),
                $this->config->verifyEmailResendThrottleWindowSec(),
            );
        } catch (TooManyAttemptsException $e) {
            $headers = [];
            if ($e->retryAfterSeconds > 0) {
                $headers[] = 'Retry-After: ' . (string)$e->retryAfterSeconds;
            }
            return [
                'status' => 429,
                'headers' => $headers,
                'body' => ['error' => 'too_many_attempts', 'retry_after' => $e->retryAfterSeconds],
            ];
        } catch (\Throwable) {
            // fail-open
        }

        try {
            $token = $this->registration->resendVerification($email);

            $payload = ['status' => 'ok'];
            if ($this->config->devReturnVerificationToken() && is_string($token) && $token !== '') {
                $payload['verification_token'] = $token;
                $link = $this->buildVerificationLink($token);
                if ($link !== null) {
                    $payload['verification_link'] = $link;
                }
            }
            if (is_string($token) && $token !== '' && $this->emailDelivery !== null) {
                $link = $this->buildVerificationLink($token);
                if ($link !== null) {
                    try {
                        $this->emailDelivery->queueVerificationEmail(
                            $email,
                            null,
                            $token,
                            $link,
                            $this->config->emailVerificationTtl(),
                        );
                        $payload['email_queued'] = true;
                    } catch (\Throwable $e) {
                        $this->logger->warning('email_verification_enqueue_failed', ['error' => $e->getMessage()]);
                        $payload['email_queued'] = false;
                    }
                }
            }
            return ['status' => 200, 'body' => $payload];
        } catch (\Throwable) {
            return ['status' => 200, 'body' => ['status' => 'ok']];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function passwordResetRequest(array $request): array
    {
        if ($this->passwordResets === null) {
            return ['status' => 501, 'body' => ['error' => 'password_reset_disabled']];
        }

        $method = strtoupper($request['method']);
        if ($method !== 'POST') {
            return ['status' => 405, 'body' => ['error' => 'method_not_allowed']];
        }

        $body = $request['body'];
        $email = (string)($body['email'] ?? ($body['username'] ?? ''));
        if (trim($email) === '') {
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }

        $headers = $request['headers'];
        $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');

        // Throttle must be non-enumerating: applied before user lookup.
        try {
            PasswordResetLimiter::assertAllowed(
                null,
                $email,
                $this->config->passwordResetThrottleMaxPerIp(),
                $this->config->passwordResetThrottleMaxPerEmail(),
                $this->config->passwordResetThrottleWindowSec(),
            );
        } catch (TooManyAttemptsException $e) {
            $headers = [];
            if ($e->retryAfterSeconds > 0) {
                $headers[] = 'Retry-After: ' . (string)$e->retryAfterSeconds;
            }
            return [
                'status' => 429,
                'headers' => $headers,
                'body' => ['error' => 'too_many_attempts', 'retry_after' => $e->retryAfterSeconds],
            ];
        } catch (\Throwable) {
            // fail-open
        }

        try {
            $issued = $this->passwordResets->issueForEmail($email, null, null, $userAgent ?: null);
            $token = $issued?->token();

            if (is_string($token) && $token !== '' && $this->passwordResetDelivery !== null) {
                $link = $this->buildPasswordResetLink($token);
                if ($link !== null) {
                    try {
                        $this->passwordResetDelivery->queuePasswordResetEmail(
                            $email,
                            null,
                            $token,
                            $link,
                            $this->config->passwordResetTtl(),
                        );
                    } catch (\Throwable $e) {
                        $this->logger->warning('password_reset_enqueue_failed', ['error' => $e->getMessage()]);
                    }
                }
            }

            $payload = ['status' => 'ok'];
            if ($this->config->devReturnPasswordResetToken() && is_string($token) && $token !== '') {
                $payload['reset_token'] = $token;
                $link = $this->buildPasswordResetLink($token);
                if ($link !== null) {
                    $payload['reset_link'] = $link;
                }
            }

            // Always return OK (non-enumerating).
            return ['status' => 200, 'body' => $payload];
        } catch (\Throwable) {
            return ['status' => 200, 'body' => ['status' => 'ok']];
        }
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function passwordResetConfirm(array $request): array
    {
        if ($this->passwordResets === null) {
            return ['status' => 501, 'body' => ['error' => 'password_reset_disabled']];
        }

        $method = strtoupper($request['method']);
        if ($method !== 'POST') {
            return ['status' => 405, 'body' => ['error' => 'method_not_allowed']];
        }

        $body = $request['body'];
        $token = (string)($body['token'] ?? ($body['reset_token'] ?? ''));
        $newPassword = (string)($body['new_password'] ?? ($body['password'] ?? ''));
        if (trim($token) === '' || trim($newPassword) === '') {
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }

        $headers = $request['headers'];
        $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');

        try {
            $this->passwordResets->resetPassword($token, $newPassword, null, $userAgent ?: null, ['purpose' => 'password_reset']);
            return ['status' => 200, 'body' => ['status' => 'ok']];
        } catch (PasswordResetException $e) {
            return ['status' => 400, 'body' => ['error' => $e->reason]];
        } catch (\Throwable) {
            return ['status' => 400, 'body' => ['error' => 'invalid_token']];
        }
    }

    private function buildVerificationLink(string $token): ?string
    {
        $template = trim($this->config->emailVerificationLinkTemplate());
        if ($template === '') {
            $base = rtrim($this->config->publicBaseUrl(), '/');
            if ($base === '') {
                return null;
            }
            $template = $base . '/verify-email?token={token}';
        }
        return str_replace('{token}', rawurlencode($token), $template);
    }

    private function buildPasswordResetLink(string $token): ?string
    {
        $template = trim($this->config->passwordResetLinkTemplate());
        if ($template === '') {
            $base = rtrim($this->config->publicBaseUrl(), '/');
            if ($base === '') {
                return null;
            }
            $template = $base . '/password-reset?token={token}';
        }
        return str_replace('{token}', rawurlencode($token), $template);
    }

    /** @return array{access_token:string,refresh_token:string,expires_at:int} */
    private function formatPair(TokenPair $pair): array
    {
        return [
            'access_token' => $pair->accessToken,
            'refresh_token' => $pair->refreshToken,
            'expires_at' => $pair->expiresAt,
        ];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function userinfo(array $request): array
    {
        [$claims, $error] = $this->claimsFromRequest($request);
        if ($error !== null) {
            return $error;
        }
        if ($claims === null) {
            return ['status' => 401, 'body' => ['error' => 'invalid_token']];
        }
        $allowed = [
            'sub' => $claims['sub'] ?? null,
            'email' => $claims['email'] ?? null,
            'name' => $claims['name'] ?? ($claims['email'] ?? null),
            'roles' => $claims['roles'] ?? [],
            'scopes' => $claims['scopes'] ?? [],
        ];
        return ['status' => 200, 'body' => array_filter($allowed, static fn($value) => $value !== null)];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function handleSessionCollection(array $request): array
    {
        $method = strtoupper($request['method']);
        return match ($method) {
            'POST' => $this->sessionIssue($request),
            'GET' => $this->sessionList($request),
            default => ['status' => 405, 'body' => ['error' => 'method_not_allowed']],
        };
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function handleDynamicRoutes(string $path, array $request): array
    {
        if (preg_match('~^/session/([^/]+)$~', $path, $match)) {
            $method = strtoupper($request['method']);
            if ($method === 'DELETE') {
                return $this->sessionDelete($request, $match[1]);
            }
            return ['status' => 405, 'body' => ['error' => 'method_not_allowed']];
        }
        return ['status' => 404, 'body' => ['error' => 'not-found']];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function sessionIssue(array $request): array
    {
        if (!$this->auth->sessionService()) {
            return ['status' => 501, 'body' => ['error' => 'sessions_disabled']];
        }
        [$claims, $error] = $this->claimsFromRequest($request);
        if ($error !== null) {
            return $error;
        }
        if ($claims === null) {
            return ['status' => 401, 'body' => ['error' => 'invalid_token']];
        }

        $rawContext = $request['body']['context'] ?? null;
        $context = [];
        if (is_array($rawContext)) {
            foreach ($rawContext as $key => $value) {
                if (is_string($key)) {
                    $context[$key] = $value;
                }
            }
        }

        $session = $this->auth->issueSession($claims, $context);
        return ['status' => 201, 'body' => [
            'session_id' => $session->id,
            'subject' => $session->subject,
            'expires_at' => $session->expiresAt,
            'context' => $session->context,
        ]];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function sessionList(array $request): array
    {
        $service = $this->auth->sessionService();
        if (!$service) {
            return ['status' => 501, 'body' => ['error' => 'sessions_disabled']];
        }
        [$claims, $error] = $this->claimsFromRequest($request);
        if ($error !== null) {
            return $error;
        }
        if ($claims === null) {
            return ['status' => 401, 'body' => ['error' => 'invalid_token']];
        }
        $sessions = $service->sessionsFor((string)($claims['sub'] ?? ''));
        return ['status' => 200, 'body' => array_map(fn($session) => [
            'session_id' => $session->id,
            'issued_at' => $session->issuedAt,
            'expires_at' => $session->expiresAt,
            'context' => $session->context,
        ], $sessions)];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function sessionDelete(array $request, string $sessionId): array
    {
        $service = $this->auth->sessionService();
        if (!$service) {
            return ['status' => 501, 'body' => ['error' => 'sessions_disabled']];
        }
        [$claims, $error] = $this->claimsFromRequest($request);
        if ($error !== null) {
            return $error;
        }
        if ($claims === null) {
            return ['status' => 401, 'body' => ['error' => 'invalid_token']];
        }
        $session = $service->validate($sessionId);
        if ($session === null) {
            return ['status' => 404, 'body' => ['error' => 'session_not_found']];
        }
        if ($session->subject !== ($claims['sub'] ?? null)) {
            return ['status' => 403, 'body' => ['error' => 'forbidden']];
        }
        $service->revoke($sessionId);
        return ['status' => 204, 'body' => []];
    }

    /**
     * @param HttpRequest $request
     * @return array{0:Claims,1:null}|array{0:null,1:HttpResponse}
     */
    private function claimsFromRequest(array $request): array
    {
        $token = $this->extractBearer($request);
        if (!$token) {
            return [null, ['status' => 401, 'body' => ['error' => 'missing_token']]];
        }
        try {
            return [$this->auth->verifyAccessToken($token), null];
        } catch (\Throwable $e) {
            return [null, ['status' => 401, 'body' => ['error' => $e->getMessage()]]];
        }
    }

    /** @param HttpRequest $request */
    private function extractBearer(array $request): ?string
    {
        $headers = $request['headers'];
        $auth = $headers['Authorization'] ?? $headers['authorization'] ?? null;
        if (!$auth || !str_starts_with($auth, 'Bearer ')) {
            return null;
        }
        return substr($auth, 7);
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function deviceCodeIssue(array $request): array
    {
        if (!$this->deviceCodes) {
            return ['status' => 501, 'body' => ['error' => 'device_code_disabled']];
        }
        $body = $request['body'];
        $clientId = (string)($body['client_id'] ?? '');
        if ($clientId === '' || !$this->auth->hasClient($clientId)) {
            try {
                $headers = $request['headers'];
                $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
                AuthAudit::record('device_code_issue_failure', null, null, $userAgent ?: null, null, ['reason' => 'invalid_client']);
            } catch (\Throwable) {
            }
            return ['status' => 400, 'body' => ['error' => 'invalid_client']];
        }
        $scopes = $this->parseScopes((string)($body['scope'] ?? ''));
        $payload = $this->deviceCodes->issue($clientId, $scopes);
        try {
            $headers = $request['headers'];
            $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
            AuthAudit::record('device_code_issue', null, null, $userAgent ?: null, null, [
                'client_id' => $clientId,
                'scopes' => $scopes,
            ]);
        } catch (\Throwable) {
        }
        return ['status' => 200, 'body' => $payload];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function deviceCodeActivate(array $request): array
    {
        if (!$this->deviceCodes) {
            return ['status' => 501, 'body' => ['error' => 'device_code_disabled']];
        }
        $body = $request['body'];
        $userCode = (string)($body['user_code'] ?? '');
        $username = (string)($body['username'] ?? '');
        $password = (string)($body['password'] ?? '');
        $headers = $request['headers'];
        $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
        $email = filter_var($username, FILTER_VALIDATE_EMAIL) ? $username : null;
        if ($userCode === '' || $username === '' || $password === '') {
            try {
                AuthAudit::record('device_code_activate_failure', null, null, $userAgent ?: null, $email, ['reason' => 'invalid_request']);
            } catch (\Throwable) {
            }
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }
        try {
            $pair = $this->auth->passwordGrant($username, $password);
        } catch (TooManyAttemptsException $e) {
            try {
                AuthAudit::record('device_code_activate_failure', null, null, $userAgent ?: null, $email, [
                    'reason' => 'too_many_attempts',
                    'retry_after' => $e->retryAfterSeconds,
                ]);
            } catch (\Throwable) {
            }
            $headers = [];
            if ($e->retryAfterSeconds > 0) {
                $headers[] = 'Retry-After: ' . (string)$e->retryAfterSeconds;
            }
            return [
                'status' => 429,
                'headers' => $headers,
                'body' => ['error' => 'too_many_attempts', 'retry_after' => $e->retryAfterSeconds],
            ];
        } catch (\Throwable $e) {
            try {
                AuthAudit::record('device_code_activate_failure', null, null, $userAgent ?: null, $email, ['reason' => 'invalid_credentials']);
            } catch (\Throwable) {
            }
            return ['status' => 401, 'body' => ['error' => 'invalid_credentials']];
        }
        $result = $this->deviceCodes->approve($userCode, $this->formatPair($pair));
        if ($result['status'] === 'approved') {
            $userId = null;
            try {
                $claims = $this->auth->verifyAccessToken($pair->accessToken);
                $sub = (string)($claims['sub'] ?? '');
                if (ctype_digit($sub)) {
                    $userId = (int)$sub;
                }
            } catch (\Throwable) {
            }
            try {
                AuthAudit::record('device_code_activate_success', $userId && $userId > 0 ? $userId : null, null, $userAgent ?: null, $email);
            } catch (\Throwable) {
            }
            return ['status' => 200, 'body' => ['status' => 'approved']];
        }
        try {
            AuthAudit::record('device_code_activate_failure', null, null, $userAgent ?: null, $email, [
                'reason' => $result['error'],
            ]);
        } catch (\Throwable) {
        }
        return ['status' => 400, 'body' => ['error' => $result['error']]];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function deviceCodePoll(array $request): array
    {
        if (!$this->deviceCodes) {
            return ['status' => 501, 'body' => ['error' => 'device_code_disabled']];
        }
        $body = $request['body'];
        $deviceCode = (string)($body['device_code'] ?? '');
        if ($deviceCode === '') {
            try {
                $headers = $request['headers'];
                $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
                AuthAudit::record('device_code_poll_failure', null, null, $userAgent ?: null, null, ['reason' => 'invalid_request']);
            } catch (\Throwable) {
            }
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }
        $result = $this->deviceCodes->poll($deviceCode);
        if ($result['status'] === 'approved') {
            try {
                $headers = $request['headers'];
                $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
                AuthAudit::record('device_code_poll_success', null, null, $userAgent ?: null, null);
            } catch (\Throwable) {
            }
        } elseif ($result['status'] === 'error') {
            try {
                $headers = $request['headers'];
                $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
                AuthAudit::record('device_code_poll_failure', null, null, $userAgent ?: null, null, [
                    'reason' => $result['error'],
                ]);
            } catch (\Throwable) {
            }
        }
        return match ($result['status']) {
            'approved' => ['status' => 200, 'body' => $result['tokens']],
            'pending' => ['status' => 400, 'body' => ['error' => $result['error']]],
            default => ['status' => 400, 'body' => ['error' => $result['error']]],
        };
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function magicLinkRequest(array $request): array
    {
        if (!$this->magicLinks) {
            return ['status' => 501, 'body' => ['error' => 'magic_link_disabled']];
        }
        $body = $request['body'];
        $email = trim((string)($body['email'] ?? ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }

        $headers = $request['headers'];
        $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');

        // Throttle must be non-enumerating: applied before identity lookup.
        try {
            MagicLinkLimiter::assertAllowed(
                null,
                $email,
                $this->config->magicLinkThrottleMaxPerIp(),
                $this->config->magicLinkThrottleMaxPerEmail(),
                $this->config->magicLinkThrottleWindowSec(),
            );
        } catch (TooManyAttemptsException $e) {
            try {
                AuthAudit::record('magic_link_throttled', null, null, $userAgent ?: null, $email, [
                    'retry_after' => $e->retryAfterSeconds,
                ]);
            } catch (\Throwable) {
            }
            $headers = [];
            if ($e->retryAfterSeconds > 0) {
                $headers[] = 'Retry-After: ' . (string)$e->retryAfterSeconds;
            }
            return [
                'status' => 429,
                'headers' => $headers,
                'body' => ['error' => 'too_many_attempts', 'retry_after' => $e->retryAfterSeconds],
            ];
        } catch (\Throwable) {
            // fail-open
        }

        try {
            AuthAudit::record('magic_link_request', null, null, $userAgent ?: null, $email);
        } catch (\Throwable) {
        }

        $ttl = (int)($this->config->magicLinkTtl() ?? 0);
        $payload = [
            'status' => 'sent',
            'expires_at' => time() + max(0, $ttl),
        ];

        $identity = $this->auth->findIdentityByEmail($email);
        if ($identity === null) {
            // Always non-enumerating.
            return ['status' => 200, 'body' => $payload];
        }

        $subject = trim((string)($identity['id'] ?? ''));
        if ($subject === '') {
            return ['status' => 200, 'body' => $payload];
        }

        $context = [];
        if (!empty($body['redirect'])) {
            $context['redirect'] = (string)$body['redirect'];
        }

        $issued = $this->magicLinks->issue($subject, $context);
        $payload['expires_at'] = $issued['expires_at'];
        $token = $issued['token'];
        $link = $issued['link'];

        if ($token !== '' && $link !== '' && $this->magicLinkDelivery !== null) {
            try {
                $userId = ctype_digit($subject) ? (int)$subject : null;
                $this->magicLinkDelivery->queueMagicLinkEmail(
                    $email,
                    $userId && $userId > 0 ? $userId : null,
                    $token,
                    $link,
                    $ttl,
                );
                try {
                    AuthAudit::record('magic_link_email_queued', $userId && $userId > 0 ? $userId : null, null, $userAgent ?: null, $email, [
                        'ttl' => $ttl,
                    ]);
                } catch (\Throwable) {
                }
            } catch (\Throwable $e) {
                $this->logger->warning('magic_link_enqueue_failed', ['error' => $e->getMessage()]);
            }
        }

        if ($this->config->devReturnMagicLinkToken() && $token !== '') {
            $payload['token'] = $token;
            if ($link !== '') {
                $payload['link'] = $link;
            }
        }

        return ['status' => 200, 'body' => $payload];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function magicLinkConsume(array $request): array
    {
        if (!$this->magicLinks) {
            return ['status' => 501, 'body' => ['error' => 'magic_link_disabled']];
        }
        $body = $request['body'];
        $token = (string)($body['token'] ?? '');
        if ($token === '') {
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }
        $payload = $this->magicLinks->consume($token);
        if ($payload === null) {
            return ['status' => 400, 'body' => ['error' => 'invalid_or_expired_magic_link']];
        }
        $identity = $this->auth->findIdentityById($payload['subject']);
        if ($identity === null) {
            return ['status' => 404, 'body' => ['error' => 'user_not_found']];
        }
        $pair = $this->auth->issueForIdentity($identity);
        $response = $this->formatPair($pair);
        if ($payload['context']) {
            $response['context'] = $payload['context'];
        }
        return ['status' => 200, 'body' => $response];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function webauthnRegisterStart(array $request): array
    {
        if (!$this->webauthn) {
            return ['status' => 501, 'body' => ['error' => 'webauthn_disabled']];
        }
        [$claims, $error] = $this->claimsFromRequest($request);
        if ($error !== null) {
            return $error;
        }
        if ($claims === null) {
            return ['status' => 401, 'body' => ['error' => 'invalid_token']];
        }
        $subject = (string)($claims['sub'] ?? '');
        if ($subject === '') {
            return ['status' => 400, 'body' => ['error' => 'invalid_subject']];
        }
        $options = $this->webauthn->startRegistration($subject);
        return ['status' => 200, 'body' => $options];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function webauthnRegisterFinish(array $request): array
    {
        if (!$this->webauthn) {
            return ['status' => 501, 'body' => ['error' => 'webauthn_disabled']];
        }
        [$claims, $error] = $this->claimsFromRequest($request);
        if ($error !== null) {
            return $error;
        }
        if ($claims === null) {
            return ['status' => 401, 'body' => ['error' => 'invalid_token']];
        }
        $body = $request['body'];
        $subject = (string)($claims['sub'] ?? '');
        $challenge = (string)($body['challenge'] ?? '');
        $credentialId = (string)($body['credential_id'] ?? '');
        $publicKey = (string)($body['public_key'] ?? '');
        if ($subject === '' || $challenge === '' || $credentialId === '' || $publicKey === '') {
            try {
                $headers = $request['headers'];
                $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
                $userId = ctype_digit($subject) ? (int)$subject : null;
                AuthAudit::record('webauthn_register_failure', $userId && $userId > 0 ? $userId : null, null, $userAgent ?: null, null, ['reason' => 'invalid_request']);
            } catch (\Throwable) {
            }
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }
        $ok = $this->webauthn->finishRegistration($subject, $challenge, $credentialId, $publicKey);
        try {
            $headers = $request['headers'];
            $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
            $userId = ctype_digit($subject) ? (int)$subject : null;
            AuthAudit::record(
                $ok ? 'webauthn_register_success' : 'webauthn_register_failure',
                $userId && $userId > 0 ? $userId : null,
                null,
                $userAgent ?: null,
                null,
                $ok ? [] : ['reason' => 'invalid_challenge']
            );
        } catch (\Throwable) {
        }
        return $ok ? ['status' => 200, 'body' => ['status' => 'registered']] : ['status' => 400, 'body' => ['error' => 'invalid_challenge']];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function webauthnAuthStart(array $request): array
    {
        if (!$this->webauthn) {
            return ['status' => 501, 'body' => ['error' => 'webauthn_disabled']];
        }
        $body = $request['body'];
        $email = (string)($body['email'] ?? '');
        if ($email === '') {
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }
        $identity = $this->auth->findIdentityByEmail($email);
        if ($identity === null) {
            return ['status' => 404, 'body' => ['error' => 'user_not_found']];
        }
        $options = $this->webauthn->startAuthentication((string)$identity['id']);
        if ($options === null) {
            return ['status' => 400, 'body' => ['error' => 'no_credentials']];
        }
        return ['status' => 200, 'body' => $options + ['user_id' => (string)$identity['id']]];
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function webauthnAuthFinish(array $request): array
    {
        if (!$this->webauthn) {
            return ['status' => 501, 'body' => ['error' => 'webauthn_disabled']];
        }
        $headers = $request['headers'];
        $userAgent = (string)($headers['User-Agent'] ?? $headers['user-agent'] ?? '');
        $body = $request['body'];
        $email = (string)($body['email'] ?? '');
        $challenge = (string)($body['challenge'] ?? '');
        $credentialId = (string)($body['credential_id'] ?? '');
        $signCount = null;
        if (array_key_exists('sign_count', $body) || array_key_exists('signCount', $body)) {
            $raw = $body['sign_count'] ?? $body['signCount'] ?? null;
            if ($raw !== null && $raw !== '') {
                $signCount = (int)$raw;
            }
        }
        if ($email === '' || $challenge === '' || $credentialId === '') {
            try {
                AuthAudit::record('webauthn_login_failure', null, null, $userAgent ?: null, filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null, ['reason' => 'invalid_request']);
            } catch (\Throwable) {
            }
            return ['status' => 400, 'body' => ['error' => 'invalid_request']];
        }
        $identity = $this->auth->findIdentityByEmail($email);
        if ($identity === null) {
            try {
                AuthAudit::record('webauthn_login_failure', null, null, $userAgent ?: null, filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null, ['reason' => 'user_not_found']);
            } catch (\Throwable) {
            }
            return ['status' => 404, 'body' => ['error' => 'user_not_found']];
        }
        $subject = (string)($identity['id'] ?? '');
        $valid = $this->webauthn->finishAuthentication($subject, $challenge, $credentialId, $signCount);
        if (!$valid) {
            try {
                $userId = ctype_digit($subject) ? (int)$subject : null;
                AuthAudit::record('webauthn_login_failure', $userId && $userId > 0 ? $userId : null, null, $userAgent ?: null, filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null, ['reason' => 'invalid_challenge']);
            } catch (\Throwable) {
            }
            return ['status' => 400, 'body' => ['error' => 'invalid_challenge']];
        }
        $pair = $this->auth->issueForIdentity($identity);
        try {
            $userId = ctype_digit($subject) ? (int)$subject : null;
            AuthAudit::record('webauthn_login_success', $userId && $userId > 0 ? $userId : null, null, $userAgent ?: null, filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null, [
                'sign_count' => $signCount,
            ]);
        } catch (\Throwable) {
        }
        return ['status' => 200, 'body' => $this->formatPair($pair)];
    }

    /**
     * @return list<string>
     */
    private function parseScopes(string $scope): array
    {
        $parts = preg_split('/\s+/', trim($scope)) ?: [];
        return array_values(array_filter($parts, fn($value) => $value !== ''));
    }

    /**
     * @param HttpRequest $request
     * @return HttpResponse
     */
    private function eventsStream(array $request): array
    {
        if ($this->events === null) {
            return ['status' => 501, 'body' => ['error' => 'events_disabled']];
        }
        $query = $request['query'];
        $lastId = isset($query['last_id']) ? (int)$query['last_id'] : null;
        $events = $this->events->history($lastId);
        return [
            'status' => 200,
            'body' => [
                'last_id' => $this->events->lastId(),
                'events' => $events,
            ],
        ];
    }
}
