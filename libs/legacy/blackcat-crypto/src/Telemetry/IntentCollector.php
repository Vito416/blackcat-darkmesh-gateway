<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Telemetry;

/**
 * Lightweight in-memory collector for crypto "intents" (encrypt/decrypt/hmac...).
 * Designed to be cheap and optional — if not wired, nothing happens.
 */
final class IntentCollector
{
    /** @var array<string,int> */
    private array $counters = [];

    /** @var array<string,array<string,int>> */
    private array $tagCounters = [
        'action' => [],
        'tenant' => [],
        'algorithm' => [],
        'route' => [],
        'context' => [],
        'pii_cluster' => [],
        'workload' => [],
        'decision' => [],
        'result' => [],
        'source' => [],
        'region' => [],
        'service' => [],
        'error_class' => [],
        'ci_ref' => [],
        'ci_sha' => [],
        'ci_run' => [],
        'ci_job' => [],
        'build_id' => [],
        'env' => [],
        'product' => [],
        'pii_label' => [],
        'workload_tier' => [],
        'kms_client' => [],
        'cipher_suite' => [],
        'db_hook' => [],
        'governance_id' => [],
        'approval_status' => [],
    ];

    /** @var array<int,array<string,mixed>> */
    private array $recent = [];
    /** @var array<string,array<string,bool>> */
    private array $dedupTagSeen = [
        'tenant' => [],
    ];
    private static ?self $global = null;

    /**
     * @param array<string,string>|null $ciContext
     */
    public function __construct(
        private int $recentLimit = 50,
        private ?string $archivePath = null,
        private ?int $archiveMaxBytes = null,
        private int $archiveKeep = 3,
        private ?array $ciContext = null,
        private ?int $archiveTtlSeconds = null
    ) {
        $this->ciContext = $ciContext ?? $this->detectCiContext();
    }

    public static function global(?self $set = null): ?self
    {
        if ($set !== null) {
            self::$global = $set;
        }
        return self::$global;
    }

    /**
     * @param array<string,mixed> $payload
     */
    public function record(string $intent, array $payload): void
    {
        $this->counters[$intent] = ($this->counters[$intent] ?? 0) + 1;

        $this->bumpTag('action', $payload['action'] ?? null);
        $this->bumpTag('tenant', $payload['tenant'] ?? $payload['tenant_id'] ?? null);
        $this->bumpTag('algorithm', $payload['algorithm'] ?? null);
        $this->bumpTag('route', $payload['route'] ?? null);
        $this->bumpTag('context', $payload['context'] ?? null);
        $this->bumpTag('pii_cluster', $payload['pii_cluster'] ?? null);
        $this->bumpTag('workload', $payload['workload'] ?? null);
        $this->bumpTag('decision', $payload['decision'] ?? $payload['policy'] ?? null);
        $this->bumpTag('result', $payload['result'] ?? null);
        $this->bumpTag('source', $payload['source'] ?? null);
        $this->bumpTag('region', $payload['region'] ?? null);
        $this->bumpTag('service', $payload['service'] ?? $payload['component'] ?? null);
        $this->bumpTag('error_class', $payload['error'] ?? $payload['error_class'] ?? null);
        $this->bumpTag('env', $payload['env'] ?? $payload['environment'] ?? null);
        $this->bumpTag('product', $payload['product'] ?? null);
        $this->bumpTag('pii_label', $payload['pii_label'] ?? null);
        $this->bumpTag('workload_tier', $payload['workload_tier'] ?? null);
        $this->bumpTag('kms_client', $payload['kms_client'] ?? null);
        $this->bumpTag('cipher_suite', $payload['cipher_suite'] ?? null);
        $this->bumpTag('db_hook', $payload['db_hook'] ?? null);
        $this->bumpTag('governance_id', $payload['governance_id'] ?? null);
        $this->bumpTag('approval_status', $payload['approval_status'] ?? null);
        if ($this->ciContext) {
            $this->bumpTag('ci_ref', $this->ciContext['ref'] ?? null);
            $this->bumpTag('ci_sha', $this->ciContext['sha'] ?? null);
            $this->bumpTag('ci_run', $this->ciContext['run_id'] ?? null);
            $this->bumpTag('ci_job', $this->ciContext['job'] ?? null);
            $this->bumpTag('build_id', $this->ciContext['build_id'] ?? null);
        }

        $entry = [
            'intent' => $intent,
            'payload' => $payload,
            'ts' => time(),
            'ci' => $this->ciContext,
        ];
        $this->recent[] = $entry;
        if (count($this->recent) > $this->recentLimit) {
            array_shift($this->recent);
        }

        $archivePath = $this->archivePath;
        if (is_string($archivePath) && $archivePath !== '') {
            if ($this->archiveMaxBytes !== null) {
                $this->rotateArchiveIfNeeded();
            }
            $meta = [
                'host' => gethostname() ?: 'unknown',
                'pid' => getmypid(),
            ];
            $encoded = json_encode(['meta' => $meta] + $entry);
            if ($encoded !== false) {
                $line = $encoded . PHP_EOL;
                @file_put_contents($archivePath, $line, FILE_APPEND | LOCK_EX);
            }
        }
    }

    /**
     * @return array<string,mixed>
     */
    public function snapshot(): array
    {
        return [
            'counts' => $this->counters,
            'tag_counts' => $this->tagCounters,
            'recent' => $this->recent,
            'ci' => $this->ciContext,
        ];
    }

    private function bumpTag(string $key, mixed $value): void
    {
        if ($value === null || $value === '') {
            return;
        }
        $bucket = &$this->tagCounters[$key];
        $value = (string) $value;
        if (isset($this->dedupTagSeen[$key][$value])) {
            return;
        }
        $bucket[$value] = ($bucket[$value] ?? 0) + 1;
        if (array_key_exists($key, $this->dedupTagSeen)) {
            $this->dedupTagSeen[$key][$value] = true;
        }
    }

    private function rotateArchiveIfNeeded(): void
    {
        if ($this->archivePath === null || $this->archiveMaxBytes === null) {
            return;
        }
        clearstatcache(false, $this->archivePath);
        $size = @filesize($this->archivePath);
        if ($size !== false && $size >= $this->archiveMaxBytes) {
            // Rotate archive.log -> archive.log.1 -> archive.log.2 ...
            for ($i = $this->archiveKeep; $i >= 1; $i--) {
                $src = $this->archivePath . ($i === 1 ? '' : '.' . ($i - 1));
                $dst = $this->archivePath . '.' . $i;
                if (file_exists($src)) {
                    @rename($src, $dst);
                }
            }
        }
        if ($this->archiveTtlSeconds !== null) {
            $cutoff = time() - $this->archiveTtlSeconds;
            for ($i = 1; $i <= $this->archiveKeep; $i++) {
                $path = $this->archivePath . '.' . $i;
                if (file_exists($path) && filemtime($path) < $cutoff) {
                    @unlink($path);
                }
            }
        }
    }

    /**
     * @return array<string,string>|null
     */
    private function detectCiContext(): ?array
    {
        $ref = getenv('GITHUB_REF') ?: getenv('CI_COMMIT_REF_NAME') ?: null;
        $sha = getenv('GITHUB_SHA') ?: getenv('CI_COMMIT_SHA') ?: null;
        $runId = getenv('GITHUB_RUN_ID') ?: getenv('CI_PIPELINE_ID') ?: null;
        $job = getenv('GITHUB_JOB') ?: getenv('CI_JOB_NAME') ?: null;
        $buildId = getenv('BUILD_ID') ?: getenv('CI_BUILD_ID') ?: null;

        $ctx = array_filter([
            'ref' => $ref ?: null,
            'sha' => $sha ?: null,
            'run_id' => $runId ?: null,
            'job' => $job ?: null,
            'build_id' => $buildId ?: null,
        ], static fn($v) => $v !== null);

        return $ctx === [] ? null : $ctx;
    }
}
