<?php
declare(strict_types=1);

namespace BlackCat\Auth\CoreCompat;

use BlackCat\Auth\AuthManager;
use BlackCat\Auth\Config\AuthConfig;
use BlackCat\Auth\Identity\DatabaseUserProvider;
use BlackCat\Auth\Identity\PlainEmailHasher;
use BlackCat\Auth\Password\PasswordHasher;
use BlackCat\Auth\Password\RuntimeConfigPepperProvider;
use BlackCat\Auth\Token\TokenPair;
use BlackCat\Auth\Token\TokenService;
use BlackCat\Core\Database;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

/**
 * Backwards-compat facade for legacy callers using `BlackCat\Core\Security\Auth`.
 *
 * New code should use `blackcat-auth` directly (e.g. `AuthRuntime`).
 */
final class CoreAuth
{
    private static ?AuthConfig $config = null;
    private static ?TokenService $tokens = null;
    private static ?PasswordHasher $hasher = null;
    private static ?DatabaseUserProvider $provider = null;
    private static ?AuthManager $auth = null;

    private function __construct() {}

    public static function getPepperVersionForStorage(): string
    {
        return self::passwordHasher()->currentPepperVersion();
    }

    public static function hashPassword(string $password): string
    {
        return self::passwordHasher()->hash($password);
    }

    public static function buildHesloAlgoMetadata(string $hash): string
    {
        return self::passwordHasher()->algorithmName($hash);
    }

    /** @return array{ok: bool, matched_version: string|null} */
    public static function verifyPasswordWithVersion(string $password, string $storedHash, ?string $hesloKeyVersion = null): array
    {
        $result = self::passwordHasher()->verify($password, $storedHash, $hesloKeyVersion);
        return ['ok' => $result->isValid(), 'matched_version' => $result->matchedVersion()];
    }

    /**
     * @deprecated Prefer `AuthRuntime` / `AuthManager` (no raw PDO plumbing).
     * @return array{success:bool,user:array<string,mixed>|null,message:string}
     */
    public static function login(\PDO $db, string $email, string $password, int $maxFailed = 5): array
    {
        unset($db, $maxFailed);

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            usleep(150_000);
            return ['success' => false, 'user' => null, 'message' => 'Invalid login'];
        }

        if (!Database::isInitialized()) {
            throw new \RuntimeException('Database not initialized. Call BlackCat\\Core\\Database::init(...) or use AuthRuntime.');
        }

        $identity = self::userProvider()->validateCredentials($email, $password);
        if ($identity === null) {
            usleep(150_000);
            return ['success' => false, 'user' => null, 'message' => 'Invalid login'];
        }

        return ['success' => true, 'user' => $identity, 'message' => 'OK'];
    }

    /** @param array<string,mixed> $userData */
    public static function isAdmin(array $userData): bool
    {
        $roles = $userData['roles'] ?? $userData['role'] ?? $userData['actor_role'] ?? null;

        $list = [];
        if (is_string($roles)) {
            $raw = trim($roles);
            if ($raw !== '') {
                $json = json_decode($raw, true);
                if (is_array($json)) {
                    $list = array_values(array_filter($json, 'is_string'));
                } elseif (str_contains($raw, ',')) {
                    $list = array_map('trim', explode(',', $raw));
                } else {
                    $list = [$raw];
                }
            }
        } elseif (is_array($roles)) {
            $list = array_values(array_filter($roles, 'is_string'));
        }

        $list = array_map(static fn(string $r) => strtolower(trim($r)), $list);
        return in_array('admin', $list, true) || in_array('administrator', $list, true);
    }

    public static function issueTokens(string $username, string $password): TokenPair
    {
        return self::authManager()->issueTokens($username, $password);
    }

    /** @return array<string,mixed> */
    public static function verifyAccessToken(string $token): array
    {
        return self::tokenService()->verify($token);
    }

    public static function refreshTokens(string $refreshToken): TokenPair
    {
        return self::authManager()->refresh($refreshToken);
    }

    private static function config(): AuthConfig
    {
        if (self::$config === null) {
            self::$config = AuthConfig::fromEnv();
        }
        return self::$config;
    }

    private static function logger(): LoggerInterface
    {
        if (Database::isInitialized()) {
            $logger = Database::getInstance()->getLogger();
            if ($logger instanceof LoggerInterface) {
                return $logger;
            }
        }
        return new NullLogger();
    }

    private static function tokenService(): TokenService
    {
        if (self::$tokens === null) {
            self::$tokens = new TokenService(self::config(), self::logger());
        }
        return self::$tokens;
    }

    private static function passwordHasher(): PasswordHasher
    {
        if (self::$hasher === null) {
            self::$hasher = new PasswordHasher(new RuntimeConfigPepperProvider('auth.pepper'));
        }
        return self::$hasher;
    }

    private static function userProvider(): DatabaseUserProvider
    {
        if (self::$provider === null) {
            if (!Database::isInitialized()) {
                throw new \RuntimeException('Database not initialized. Call BlackCat\\Core\\Database::init(...) or use AuthRuntime.');
            }
            self::$provider = new DatabaseUserProvider(
                Database::getInstance(),
                self::passwordHasher(),
                new PlainEmailHasher()
            );
        }
        return self::$provider;
    }

    private static function authManager(): AuthManager
    {
        if (self::$auth === null) {
            self::$auth = AuthManager::boot(self::config(), self::userProvider(), self::logger());
        }
        return self::$auth;
    }
}
