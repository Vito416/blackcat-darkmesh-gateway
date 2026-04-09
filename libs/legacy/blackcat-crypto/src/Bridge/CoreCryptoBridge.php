<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Bridge;

use BlackCat\Crypto\Config\CryptoConfig;
use BlackCat\Crypto\CryptoManager;
use BlackCat\Crypto\Support\Payload;
use BlackCat\Crypto\Keyring\KeyMaterial;
use Psr\Log\LoggerInterface;

/**
 * Bridge for wiring legacy `blackcat-core` classes (Crypto/FileVault) to the new `blackcat-crypto`
 * implementation so the ecosystem uses one set of slots, keys and formats.
 */
final class CoreCryptoBridge
{
    private const VERSION = 2;
    private const DEFAULT_PREFIX = 'core';
    private const SLOT_DEFAULT_ENCRYPT = 'core.crypto.default';
    private const SLOT_HMAC_CSRF = 'hmac.csrf';
    private const SLOT_HMAC_SESSION = 'core.hmac.session';
    private const SLOT_VAULT = 'core.vault';

    /** @var null|callable(string,array<string,mixed>):void */
    private static $intentEmitter = null;
    private static ?\BlackCat\Crypto\Telemetry\IntentCollector $intentCollector = null;
    private static ?CryptoManager $manager = null;
    /** @var array<string,mixed> */
    private static array $options = [
        'context_prefix' => self::DEFAULT_PREFIX,
        'wrap_queue' => 'memory',
    ];

    /**
     * Configure the bridge (keys dir, logger, KMS endpoints, ...).
     *
     * This call is idempotent: changing options resets the cached manager.
     *
     * Callers should provide `keys_dir` (or configure it via blackcat-config runtime config).
     */
    /** @param array<string,mixed> $options */
    public static function configure(array $options): void
    {
        self::$options = array_replace(self::$options, $options);
        self::$manager = null;
    }

    public static function flush(): void
    {
        self::$manager = null;
    }

    /**
     * Optional hook to broadcast crypto intents (encrypt/decrypt/hmac/verify).
     *
     * @param null|callable(string,array<string,mixed>):void $emitter receives ($intent, $payload)
     */
    public static function registerIntentEmitter(?callable $emitter): void
    {
        self::$intentEmitter = $emitter;
    }

    public static function enableIntentCollection(\BlackCat\Crypto\Telemetry\IntentCollector $collector): void
    {
        self::$intentCollector = $collector;
        self::$intentEmitter = static fn(string $intent, array $payload) => $collector->record($intent, $payload);
    }

    public static function encryptBinary(string $slot, string $plaintext): string
    {
        $payload = self::manager()->encryptLocal(self::slot($slot), $plaintext);
        self::emitIntent('encrypt', [
            'slot' => $slot,
            'keyId' => $payload->keyId,
            'ciphertextBytes' => strlen($payload->ciphertext),
        ]);
        return self::packPayload($payload);
    }

    public static function decryptBinary(string $slot, string $data): ?string
    {
        $decoded = self::unpackPayload($data);
        $manager = self::manager();

        if ($decoded['keyId'] !== null) {
            $payload = new Payload($decoded['ciphertext'], $decoded['nonce'], $decoded['keyId']);
            try {
                $out = $manager->decryptLocal(self::slot($slot), $payload);
            } catch (\Throwable) {
                $out = $manager->decryptLocalWithAnyKey(self::slot($slot), $decoded['nonce'], $decoded['ciphertext'], $decoded['keyId']);
            }
            self::emitIntent('decrypt', [
                'slot' => $slot,
                'keyId' => $decoded['keyId'],
                'nonceBytes' => strlen($decoded['nonce']),
                'success' => $out !== null,
            ]);
            return $out;
        }

        $out = $manager->decryptLocalWithAnyKey(self::slot($slot), $decoded['nonce'], $decoded['ciphertext']);
        self::emitIntent('decrypt', [
            'slot' => $slot,
            'keyId' => null,
            'nonceBytes' => strlen($decoded['nonce']),
            'success' => $out !== null,
        ]);
        return $out;
    }

    public static function hmac(string $slot, string $message): string
    {
        $sig = self::manager()->hmac(self::slot($slot), $message);
        self::emitIntent('hmac', [
            'slot' => $slot,
            'messageBytes' => strlen($message),
        ]);
        return $sig;
    }

    public static function verifyHmac(string $slot, string $message, string $signature): bool
    {
        $ok = self::manager()->verifyHmac(self::slot($slot), $message, $signature);
        self::emitIntent('verify_hmac', [
            'slot' => $slot,
            'messageBytes' => strlen($message),
            'signatureBytes' => strlen($signature),
            'success' => $ok,
        ]);
        return $ok;
    }

    /**
     * @return array{id:string,bytes:string,slot:string}
     */
    public static function deriveKeyMaterial(string $slot, ?string $forceKeyId = null): array
    {
        $resolvedSlot = self::slot($slot);
        $material = self::manager()->keyMaterial($resolvedSlot, $forceKeyId);
        return [
            'id' => $material->id,
            'bytes' => $material->bytes,
            // Keep the caller-facing slot consistent with our alias resolution.
            'slot' => $resolvedSlot,
        ];
    }

    /**
     * @return list<array{id:string,bytes:string,slot:string}>
     */
    public static function listKeyMaterial(string $slot): array
    {
        $resolvedSlot = self::slot($slot);
        $list = self::manager()->allKeyMaterial($resolvedSlot);
        return array_map(static fn(KeyMaterial $mat) => [
            'id' => $mat->id,
            'bytes' => $mat->bytes,
            'slot' => $resolvedSlot,
        ], $list);
    }

    public static function boot(): CryptoManager
    {
        return self::manager();
    }

    private static function manager(): CryptoManager
    {
        if (self::$manager === null) {
            $options = self::$options;
            $keysDir = self::resolveKeysDir();
            $manifest = self::resolveManifestPath();
            self::assertReadableKeysDir($keysDir);
            self::assertManifestIsValid($manifest);

            $config = CryptoConfig::fromArray([
                'keys_dir' => $keysDir,
                'manifest' => $manifest,
                'kms' => $options['kms'] ?? null,
                'rotation' => $options['rotation'] ?? null,
                'aead' => $options['aead'] ?? null,
                'wrap_queue' => $options['wrap_queue'] ?? null,
            ]);
            $logger = self::$options['logger'] ?? null;
            if ($logger !== null && !$logger instanceof LoggerInterface) {
                throw new \InvalidArgumentException('logger must implement LoggerInterface');
            }
            $manager = CryptoManager::boot($config, $logger);
            if (self::$intentCollector !== null) {
                $manager = $manager->withIntentCollector(self::$intentCollector);
            }
            self::$manager = $manager;
        }

        return self::$manager;
    }

    private static function slot(string $name): string
    {
        $prefix = rtrim((string)(self::$options['context_prefix'] ?? self::DEFAULT_PREFIX), '.');
        $normalized = ltrim($name, '.');

        $aliases = [
            'default' => self::SLOT_DEFAULT_ENCRYPT,
            self::SLOT_DEFAULT_ENCRYPT => self::SLOT_DEFAULT_ENCRYPT,
            'csrf' => self::SLOT_HMAC_CSRF,
            'csrf_key' => self::SLOT_HMAC_CSRF,
            self::SLOT_HMAC_CSRF => self::SLOT_HMAC_CSRF,
            'session_token_key' => self::SLOT_HMAC_SESSION,
            'session' => self::SLOT_HMAC_SESSION,
            self::SLOT_HMAC_SESSION => self::SLOT_HMAC_SESSION,
            'vault' => self::SLOT_VAULT,
            self::SLOT_VAULT => self::SLOT_VAULT,
        ];

        if (isset($aliases[$normalized])) {
            return $aliases[$normalized];
        }

        // Avoid double-prefixing if caller already passed fully-qualified slot (e.g. "core.vault").
        if (str_starts_with($normalized, $prefix . '.')) {
            return $normalized;
        }

        // For any dotted namespace not starting with the prefix, add it (e.g. "crypto.default" -> "core.crypto.default").
        if (str_contains($normalized, '.')) {
            return $prefix . '.' . $normalized;
        }

        return $prefix . '.' . $normalized;
    }

    private static function resolveKeysDir(): string
    {
        $opt = self::$options['keys_dir'] ?? null;
        if (is_string($opt) && trim($opt) !== '') {
            return trim($opt);
        }

        if (class_exists('\\BlackCat\\Config\\Runtime\\Config')) {
            /** @phpstan-ignore-next-line optional dependency */
            \BlackCat\Config\Runtime\Config::initFromFirstAvailableJsonFileIfNeeded();
            /** @phpstan-ignore-next-line optional dependency */
            $repo = \BlackCat\Config\Runtime\Config::repo();
            $raw = $repo->get('crypto.keys_dir');
            if (is_string($raw) && trim($raw) !== '') {
                return $repo->resolvePath($raw);
            }
        }

        throw new \RuntimeException('CoreCryptoBridge requires crypto.keys_dir (runtime config) or explicit keys_dir option.');
    }

    private static function resolveManifestPath(): ?string
    {
        $opt = self::$options['manifest'] ?? null;
        if (is_string($opt) && trim($opt) !== '') {
            return trim($opt);
        }

        if (class_exists('\\BlackCat\\Config\\Runtime\\Config')) {
            /** @phpstan-ignore-next-line optional dependency */
            \BlackCat\Config\Runtime\Config::initFromFirstAvailableJsonFileIfNeeded();
            /** @phpstan-ignore-next-line optional dependency */
            $repo = \BlackCat\Config\Runtime\Config::repo();
            $raw = $repo->get('crypto.manifest');
            if (is_string($raw) && trim($raw) !== '') {
                return $repo->resolvePath($raw);
            }
        }

        return null;
    }

    private static function assertReadableKeysDir(string $keysDir): void
    {
        if ($keysDir === '' || !is_dir($keysDir) || !is_readable($keysDir)) {
            throw new \InvalidArgumentException('CoreCryptoBridge requires readable keys_dir directory');
        }
    }

    private static function assertManifestIsValid(?string $manifest): void
    {
        if (!is_string($manifest) || $manifest === '') {
            return;
        }

        if (!is_file($manifest) || !is_readable($manifest)) {
            throw new \InvalidArgumentException('CoreCryptoBridge manifest is not readable: ' . $manifest);
        }
        $raw = file_get_contents($manifest);
        if ($raw === false) {
            throw new \InvalidArgumentException('CoreCryptoBridge failed to read manifest: ' . $manifest);
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new \InvalidArgumentException('CoreCryptoBridge manifest must be valid JSON: ' . $manifest);
        }
        if (!isset($decoded['slots']) || !is_array($decoded['slots'])) {
            throw new \InvalidArgumentException('CoreCryptoBridge manifest missing "slots" definition.');
        }
    }

    private static function packPayload(Payload $payload): string
    {
        $keyId = $payload->keyId ?? '';
        $keyLen = strlen($keyId);
        if ($keyLen > 255) {
            $keyId = substr($keyId, 0, 255);
            $keyLen = 255;
        }

        $nonce = $payload->nonce;
        $nonceLen = strlen($nonce);
        if ($nonceLen > 255) {
            throw new \RuntimeException('Nonce length exceeds 255 bytes');
        }

        return chr(self::VERSION)
            . chr($keyLen)
            . $keyId
            . chr($nonceLen)
            . $nonce
            . $payload->ciphertext;
    }

    /**
     * @return array{version:int,keyId:?string,nonce:string,ciphertext:string}
     */
    private static function unpackPayload(string $data): array
    {
        $ptr = 0;
        $len = strlen($data);
        if ($len < 2) {
            throw new \InvalidArgumentException('Payload too short');
        }

        $version = ord($data[$ptr++]);
        $keyId = null;
        if ($version >= self::VERSION) {
            $keyLen = ord($data[$ptr++]);
            if ($ptr + $keyLen > $len) {
                throw new \InvalidArgumentException('Payload key id out of bounds');
            }
            $keyId = $keyLen > 0 ? substr($data, $ptr, $keyLen) : null;
            $ptr += $keyLen;
        }

        if ($ptr >= $len) {
            throw new \InvalidArgumentException('Payload missing nonce length');
        }
        $nonceLen = ord($data[$ptr++]);
        if ($nonceLen < 1) {
            throw new \InvalidArgumentException('Invalid nonce length');
        }
        if ($ptr + $nonceLen > $len) {
            throw new \InvalidArgumentException('Payload nonce out of bounds');
        }
        $nonce = substr($data, $ptr, $nonceLen);
        $ptr += $nonceLen;
        $ciphertext = substr($data, $ptr);
        if ($ciphertext === '') {
            throw new \InvalidArgumentException('Payload missing ciphertext');
        }

        return [
            'version' => $version,
            'keyId' => $keyId,
            'nonce' => $nonce,
            'ciphertext' => $ciphertext,
        ];
    }

    /**
     * @param array<string,mixed> $payload
     */
    private static function emitIntent(string $intent, array $payload): void
    {
        $emitter = self::$intentEmitter;
        if ($emitter === null) {
            return;
        }
        try {
            $emitter($intent, $payload);
        } catch (\Throwable) {
            // Telemetry hooks must never break crypto flows.
        }
    }
}
