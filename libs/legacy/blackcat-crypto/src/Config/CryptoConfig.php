<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Config;

use BlackCat\Config\Runtime\Config as RuntimeConfig;
use BlackCat\Config\Runtime\ConfigRepository;
use BlackCat\Config\Runtime\RuntimeConfigValidator;
use BlackCat\Crypto\Queue\FileWrapQueue;
use BlackCat\Crypto\Queue\InMemoryWrapQueue;
use Closure;

final class CryptoConfig
{
    /**
     * @param list<array<string,mixed>> $keySources
     * @param array<string,array<string,mixed>> $slots
     * @param array<int|string,mixed> $kms
     * @param array<string,array<string,mixed>> $rotationPolicies
     */
    public function __construct(
        private readonly array $keySources = [],
        private readonly array $slots = [],
        private readonly array $kms = [],
        private readonly array $rotationPolicies = [],
        private readonly string $aeadDriver = 'xchacha',
        private readonly ?Closure $aeadFactory = null,
        private readonly ?Closure $wrapQueueFactory = null,
        private readonly ?string $manifestPath = null,
    ) {}

    /**
     * Build CryptoConfig from a BlackCat runtime config repository.
     *
     * This is the recommended bootstrap path (no getenv/ENV needed).
     */
    public static function fromRuntimeConfig(?ConfigRepository $repo = null): self
    {
        if ($repo === null) {
            RuntimeConfig::initFromFirstAvailableJsonFileIfNeeded();
            $repo = RuntimeConfig::repo();
        }

        RuntimeConfigValidator::assertCryptoConfig($repo);

        $keysDir = $repo->resolvePath($repo->requireString('crypto.keys_dir'));

        $manifestSlots = [];
        $manifestRotation = [];
        $manifestPath = null;

        $manifestRaw = $repo->get('crypto.manifest');
        if (is_string($manifestRaw) && trim($manifestRaw) !== '') {
            $candidate = $repo->resolvePath($manifestRaw);
            if (is_file($candidate)) {
                $manifestPath = $candidate;
                [$manifestSlots, $manifestRotation] = self::loadManifest($candidate);
            }
        }

        $kms = self::normalizeKmsConfig($repo->get('crypto.kms_endpoints') ?? $repo->get('crypto.kms.endpoints') ?? $repo->get('crypto.kms'));
        $rotation = self::normalizeRotationConfig($repo->get('crypto.rotation') ?? $repo->get('crypto.rotation_policies'));

        if ($manifestRotation !== []) {
            // Allow runtime config to override manifest defaults (per-install tuning).
            $rotation = array_replace($manifestRotation, $rotation);
        }

        $driver = strtolower((string)($repo->get('crypto.aead') ?? $repo->get('crypto.aead_driver') ?? 'xchacha'));
        $queueSpec = (string)($repo->get('crypto.wrap_queue') ?? $repo->get('crypto.wrap_queue_uri') ?? '');

        $queueFactory = null;
        if ($queueSpec !== '') {
            $queueFactory = static function () use ($queueSpec) {
                if ($queueSpec === 'memory') {
                    return new InMemoryWrapQueue();
                }
                $path = str_starts_with($queueSpec, 'file://')
                    ? substr($queueSpec, 7)
                    : $queueSpec;
                return new FileWrapQueue($path);
            };
        }

        return new self(
            keySources: [
                ['type' => 'filesystem', 'path' => $keysDir],
            ],
            slots: $manifestSlots,
            kms: $kms,
            rotationPolicies: $rotation,
            aeadDriver: in_array($driver, ['xchacha','hybrid'], true) ? $driver : 'xchacha',
            wrapQueueFactory: $queueFactory,
            manifestPath: $manifestPath && is_file($manifestPath) ? $manifestPath : null,
        );
    }

    /**
     * Legacy-compatible builder.
     *
     * - If `$env` is empty, this boots from blackcat-config runtime config (recommended).
     * - If `$env` is provided, it is treated as an explicit input array (tests/legacy callers),
     *   and this method does NOT call getenv()/$_ENV discovery.
     *
     * @param array<string,mixed> $env
     */
    public static function fromEnv(array $env = []): self
    {
        if ($env === []) {
            return self::fromRuntimeConfig();
        }

        $keysDir = $env['BLACKCAT_KEYS_DIR'] ?? $env['APP_KEYS_DIR'] ?? null;
        $manifest = $env['BLACKCAT_CRYPTO_MANIFEST'] ?? null;

        return self::fromArray([
            'keys_dir' => is_string($keysDir) ? $keysDir : '',
            'manifest' => is_string($manifest) ? $manifest : null,
            'kms' => $env['BLACKCAT_KMS_ENDPOINTS'] ?? null,
            'rotation' => $env['BLACKCAT_CRYPTO_ROTATION'] ?? null,
            'aead' => $env['BLACKCAT_CRYPTO_AEAD'] ?? null,
            'wrap_queue' => $env['BLACKCAT_CRYPTO_WRAP_QUEUE'] ?? null,
        ]);
    }

    /**
     * Legacy/testing helper: build CryptoConfig from an explicit array.
     *
     * This method intentionally does NOT call getenv()/$_ENV discovery.
     *
     * Supported keys (subset):
     * - keys_dir (required)
     * - manifest (optional)
     *
     * @param array<string,mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $keysDir = $data['keys_dir'] ?? null;
        if (!is_string($keysDir) || trim($keysDir) === '') {
            throw new \InvalidArgumentException('CryptoConfig keys_dir is required.');
        }
        $keysDir = trim($keysDir);

        $manifestSlots = [];
        $manifestRotation = [];
        $manifestPath = null;

        $manifest = $data['manifest'] ?? null;
        if (is_string($manifest) && trim($manifest) !== '') {
            $manifestPath = trim($manifest);
            if (is_file($manifestPath)) {
                [$manifestSlots, $manifestRotation] = self::loadManifest($manifestPath);
            }
        }

        $kms = self::normalizeKmsConfig($data['kms_endpoints'] ?? $data['kms'] ?? null);
        $rotation = self::normalizeRotationConfig($data['rotation'] ?? $data['rotation_policies'] ?? null);
        if ($manifestRotation !== []) {
            $rotation = array_replace($manifestRotation, $rotation);
        }

        $driver = strtolower((string)($data['aead'] ?? $data['aead_driver'] ?? 'xchacha'));

        $queueSpec = (string)($data['wrap_queue'] ?? $data['wrap_queue_uri'] ?? '');
        $queueFactory = null;
        if ($queueSpec !== '') {
            $queueFactory = static function () use ($queueSpec) {
                if ($queueSpec === 'memory') {
                    return new InMemoryWrapQueue();
                }
                $path = str_starts_with($queueSpec, 'file://')
                    ? substr($queueSpec, 7)
                    : $queueSpec;
                return new FileWrapQueue($path);
            };
        }

        return new self(
            keySources: [
                ['type' => 'filesystem', 'path' => $keysDir],
            ],
            slots: $manifestSlots,
            kms: $kms,
            rotationPolicies: $rotation,
            aeadDriver: in_array($driver, ['xchacha','hybrid'], true) ? $driver : 'xchacha',
            wrapQueueFactory: $queueFactory,
            manifestPath: $manifestPath && is_file($manifestPath) ? $manifestPath : null,
        );
    }

    /** @return list<array<string,mixed>> */
    public function keySources(): array
    {
        return $this->keySources;
    }

    /** @return array<string,array<string,mixed>> */
    public function slots(): array
    {
        return $this->slots;
    }

    /** @return array<int|string,mixed> */
    public function kmsConfig(): array
    {
        return $this->kms;
    }

    /** @return array<string,array<string,mixed>> */
    public function rotationPolicies(): array
    {
        return $this->rotationPolicies;
    }

    /** @return Closure|null */
    public function aeadFactory(): ?Closure
    {
        return $this->aeadFactory;
    }

    public function aeadDriver(): string
    {
        return $this->aeadFactory ? 'custom' : $this->aeadDriver;
    }

    /** @return Closure|null */
    public function wrapQueueFactory(): ?Closure
    {
        return $this->wrapQueueFactory;
    }

    public function manifestPath(): ?string
    {
        return $this->manifestPath;
    }

    /**
     * @return array{0:array<string,mixed>,1:array<string,mixed>}
     */
    private static function loadManifest(string $path): array
    {
        $json = file_get_contents($path);
        if ($json === false) {
            throw new \RuntimeException('Cannot read manifest ' . $path);
        }
        $data = json_decode($json, true);
        if (!is_array($data)) {
            throw new \RuntimeException('Manifest ' . $path . ' is not valid JSON');
        }

        $slots = $data['slots'] ?? [];
        $rotation = $data['rotation'] ?? [];
        if (!is_array($slots)) {
            $slots = [];
        }
        if (!is_array($rotation)) {
            $rotation = [];
        }
        return [$slots, $rotation];
    }

    /**
     * @return array<int|string,mixed>
     */
    private static function normalizeKmsConfig(mixed $raw): array
    {
        if ($raw === null) {
            return [];
        }

        if (is_array($raw)) {
            return $raw;
        }

        if (is_string($raw)) {
            $raw = trim($raw);
            if ($raw === '') {
                return [];
            }

            $json = json_decode($raw, true);
            if (is_array($json)) {
                return $json;
            }

            // Parse comma-separated KMS endpoints like "a=http://host:7001,b=hsm://slot1".
            $kms = [];
            $pairs = array_filter(array_map('trim', explode(',', $raw)));
            foreach ($pairs as $pair) {
                if (!str_contains($pair, '=')) {
                    continue;
                }
                [$id, $endpoint] = array_map('trim', explode('=', $pair, 2));
                if ($id === '' || $endpoint === '') {
                    continue;
                }
                $scheme = parse_url($endpoint, PHP_URL_SCHEME) ?: '';
                $type = $scheme === 'hsm' ? 'hsm' : 'http';
                $kms[] = [
                    'id' => $id,
                    'endpoint' => $endpoint,
                    'type' => $type,
                ];
            }
            return $kms;
        }

        return [];
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    private static function normalizeRotationConfig(mixed $raw): array
    {
        if ($raw === null) {
            return [];
        }

        if (is_array($raw)) {
            /** @var array<string,array<string,mixed>> $raw */
            return $raw;
        }

        if (is_string($raw)) {
            $raw = trim($raw);
            if ($raw === '') {
                return [];
            }

            $json = json_decode($raw, true);
            return is_array($json) ? $json : [];
        }

        return [];
    }
}
