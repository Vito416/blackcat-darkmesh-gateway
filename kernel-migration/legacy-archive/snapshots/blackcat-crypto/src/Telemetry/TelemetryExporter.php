<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Telemetry;

use BlackCat\Crypto\Queue\WrapQueueInterface;
use BlackCat\Crypto\Queue\WrapJob;

final class TelemetryExporter
{
    /**
     * @param array<int,array<string,mixed>> $kmsHealth
     * @param array<string,mixed>|null $ciMeta
     * @return array<string,mixed>
     */
    public static function snapshot(array $kmsHealth, ?WrapQueueInterface $queue = null, ?IntentCollector $collector = null, ?array $ciMeta = null): array
    {
        $collector = $collector ?? IntentCollector::global();
        $timestamp = time();
        $clients = [];
        $up = 0;
        $suspendedTotal = 0;
        foreach ($kmsHealth as $entry) {
            $client = self::enrichKmsClient($entry);
            $clients[] = $client;

            if (strtolower((string)$client['status']) === 'ok') {
                $up++;
            }
            if (($client['suspended'] ?? false) === true) {
                $suspendedTotal++;
            }
        }
        $queueMetrics = self::queueMetrics($queue);
        $intents = $collector ? $collector->snapshot() : null;
        $ci = $ciMeta ?? ($intents['ci'] ?? null);
        return [
            'timestamp' => $timestamp,
            'kms_up_total' => $up,
            'kms_suspended_total' => $suspendedTotal,
            'kms_clients' => $clients,
            'wrap_queue' => $queueMetrics,
            'intents' => $intents,
            'ci' => $ci,
        ];
    }

    /** @param array<string,mixed> $snapshot */
    public static function asPrometheus(array $snapshot): string
    {
        $lines = [];
        $lines[] = '# HELP blackcat_kms_up_total Number of healthy KMS clients.';
        $lines[] = '# TYPE blackcat_kms_up_total gauge';
        $lines[] = 'blackcat_kms_up_total ' . (int)($snapshot['kms_up_total'] ?? 0);
        $lines[] = '# HELP blackcat_kms_health_info Status of each KMS client.';
        $lines[] = '# TYPE blackcat_kms_health_info gauge';
        foreach ($snapshot['kms_clients'] ?? [] as $client) {
            $clientId = $client['id'] ?? 'unknown';
            $status = strtolower((string)($client['status'] ?? 'unknown'));
            $value = $status === 'ok' ? 1 : 0;
            $lines[] = sprintf(
                'blackcat_kms_health_info{client="%s",status="%s",suspended="%s"} %d',
                self::escapeLabel((string)$clientId),
                self::escapeLabel($status),
                ($client['suspended'] ?? false) ? 'true' : 'false',
                $value
            );
        }
        $lines[] = '# HELP blackcat_kms_suspended_total Number of suspended KMS clients.';
        $lines[] = '# TYPE blackcat_kms_suspended_total gauge';
        $lines[] = 'blackcat_kms_suspended_total ' . (int)($snapshot['kms_suspended_total'] ?? 0);
        $queue = $snapshot['wrap_queue'] ?? [];
        $lines[] = '# HELP blackcat_wrap_queue_backlog Number of pending wrap jobs.';
        $lines[] = '# TYPE blackcat_wrap_queue_backlog gauge';
        $lines[] = 'blackcat_wrap_queue_backlog ' . (int)($queue['backlog'] ?? 0);
        $lines[] = '# HELP blackcat_wrap_queue_failed_total Number of wrap jobs marked as failed (attempts > 0 or last error).';
        $lines[] = '# TYPE blackcat_wrap_queue_failed_total gauge';
        $lines[] = 'blackcat_wrap_queue_failed_total ' . (int)($queue['failed'] ?? 0);
        $lines[] = '# HELP blackcat_wrap_queue_oldest_age_seconds Age of the oldest pending wrap job.';
        $lines[] = '# TYPE blackcat_wrap_queue_oldest_age_seconds gauge';
        $lines[] = 'blackcat_wrap_queue_oldest_age_seconds ' . (int)($queue['oldest_age_seconds'] ?? 0);

        $intents = $snapshot['intents']['counts'] ?? [];
        $lines[] = '# HELP blackcat_intents_total Total crypto intents recorded by type.';
        $lines[] = '# TYPE blackcat_intents_total counter';
        if (empty($intents)) {
            $lines[] = 'blackcat_intents_total 0';
        } else {
            foreach ($intents as $intent => $count) {
                $lines[] = sprintf(
                    'blackcat_intents_total{intent="%s"} %d',
                    self::escapeLabel((string)$intent),
                    (int)$count
                );
            }
        }

        $tagCounts = $snapshot['intents']['tag_counts'] ?? [];
        if (!empty($tagCounts)) {
            $lines[] = '# HELP blackcat_intents_by_tag_total Total crypto intents grouped by tag.';
            $lines[] = '# TYPE blackcat_intents_by_tag_total counter';
            foreach ($tagCounts as $tagKey => $pairs) {
                foreach ($pairs as $tagValue => $count) {
                    $lines[] = sprintf(
                        'blackcat_intents_by_tag_total{tag_key="%s",tag_value="%s"} %d',
                        self::escapeLabel((string)$tagKey),
                        self::escapeLabel((string)$tagValue),
                        (int)$count
                    );
                }
            }
        }

        $ci = $snapshot['ci'] ?? ($snapshot['intents']['ci'] ?? null);
        if (is_array($ci) && !empty($ci)) {
            $lines[] = '# HELP blackcat_ci_info CI context attached to crypto intents.';
            $lines[] = '# TYPE blackcat_ci_info gauge';
            $lines[] = sprintf(
                'blackcat_ci_info{ref="%s",sha="%s",run_id="%s",job="%s",build_id="%s"} 1',
                self::escapeLabel((string)($ci['ref'] ?? '')),
                self::escapeLabel((string)($ci['sha'] ?? '')),
                self::escapeLabel((string)($ci['run_id'] ?? '')),
                self::escapeLabel((string)($ci['job'] ?? '')),
                self::escapeLabel((string)($ci['build_id'] ?? ''))
            );
        }
        return implode("\n", $lines) . "\n";
    }

    /**
     * Minimal OpenTelemetry ResourceMetrics payload (OTLP/JSON shape).
     *
     * @param array<string,mixed> $snapshot
     * @return array<string,mixed>
     */
    public static function asOpenTelemetry(array $snapshot, string $serviceName = 'blackcat-crypto', string $scopeName = 'blackcat.crypto'): array
    {
        $ts = (int)floor(microtime(true) * 1_000_000_000);
        $metrics = [];
        $ci = $snapshot['ci'] ?? ($snapshot['intents']['ci'] ?? null);

        $metrics[] = self::gaugeMetric(
            'blackcat.kms.up_total',
            'Number of healthy KMS clients.',
            (int)($snapshot['kms_up_total'] ?? 0),
            $ts
        );

        $metrics[] = self::gaugeMetric(
            'blackcat.kms.suspended_total',
            'Number of suspended KMS clients.',
            (int)($snapshot['kms_suspended_total'] ?? 0),
            $ts
        );

        foreach ($snapshot['kms_clients'] ?? [] as $client) {
            $status = strtolower((string)($client['status'] ?? 'unknown'));
            $value = $status === 'ok' ? 1 : 0;
            $metrics[] = self::gaugeMetric(
                'blackcat.kms.health',
                'KMS client health (1 ok / 0 otherwise).',
                $value,
                $ts,
                [
                    'client' => (string)($client['id'] ?? 'unknown'),
                    'status' => $status,
                    'suspended' => ($client['suspended'] ?? false) ? 'true' : 'false',
                ]
            );
        }

        $queue = $snapshot['wrap_queue'] ?? [];
        $metrics[] = self::gaugeMetric(
            'blackcat.wrap_queue.backlog',
            'Number of pending wrap jobs.',
            (int)($queue['backlog'] ?? 0),
            $ts
        );
        $metrics[] = self::gaugeMetric(
            'blackcat.wrap_queue.failed_total',
            'Number of wrap jobs marked as failed.',
            (int)($queue['failed'] ?? 0),
            $ts
        );
        $metrics[] = self::gaugeMetric(
            'blackcat.wrap_queue.oldest_age_seconds',
            'Age of the oldest pending wrap job.',
            (int)($queue['oldest_age_seconds'] ?? 0),
            $ts
        );

        $intents = $snapshot['intents']['counts'] ?? [];
        $intentPoints = [];
        foreach ($intents as $intent => $count) {
            $intentPoints[] = self::numberDataPoint((int)$count, $ts, ['intent' => (string)$intent]);
        }
        $metrics[] = [
            'name' => 'blackcat.intents.total',
            'description' => 'Total crypto intents recorded by type.',
            'unit' => '1',
            'sum' => [
                'aggregationTemporality' => 2, // CUMULATIVE
                'isMonotonic' => true,
                'dataPoints' => $intentPoints ?: [self::numberDataPoint(0, $ts)],
            ],
        ];

        $tagCounts = $snapshot['intents']['tag_counts'] ?? [];
        $tagPoints = [];
        foreach ($tagCounts as $tagKey => $pairs) {
            foreach ($pairs as $tagValue => $count) {
                $tagPoints[] = self::numberDataPoint(
                    (int)$count,
                    $ts,
                    [
                        'tag_key' => (string)$tagKey,
                        'tag_value' => (string)$tagValue,
                    ]
                );
            }
        }
        if (!empty($tagPoints)) {
            $metrics[] = [
                'name' => 'blackcat.intents.by_tag',
                'description' => 'Total crypto intents grouped by tag.',
                'unit' => '1',
                'sum' => [
                    'aggregationTemporality' => 2,
                    'isMonotonic' => true,
                    'dataPoints' => $tagPoints,
                ],
            ];
        }

        $resourceAttrs = ['service.name' => $serviceName];
        if (!is_array($ci)) {
            $ci = $snapshot['intents']['ci'] ?? null;
        }
        if (is_array($ci) && !empty($ci)) {
            foreach (['ref', 'sha', 'run_id', 'job', 'build_id'] as $key) {
                if (!empty($ci[$key])) {
                    $resourceAttrs['ci.' . $key] = (string)$ci[$key];
                }
            }
        }

        return [
            'resourceMetrics' => [
                [
                    'resource' => [
                        'attributes' => self::attributes($resourceAttrs),
                    ],
                    'scopeMetrics' => [
                        [
                            'scope' => [
                                'name' => $scopeName,
                                'version' => '1.0.0',
                            ],
                            'metrics' => $metrics,
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * Minimal OTLP/JSON logs payload for recent intents.
     *
     * @param array<string,mixed> $snapshot
     * @return array<string,mixed>
     */
    public static function asOpenTelemetryLogs(array $snapshot, string $serviceName = 'blackcat-crypto', string $scopeName = 'blackcat.crypto'): array
    {
        $now = (int)floor(microtime(true) * 1_000_000_000);
        $recent = $snapshot['intents']['recent'] ?? [];
        if (!is_array($recent)) {
            $recent = [];
        }
        $recent = array_slice(array_values($recent), -25);

        $logRecords = [];
        foreach ($recent as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $tsVal = $entry['timestamp'] ?? $entry['ts'] ?? null;
            $ts = $tsVal !== null ? (int)$tsVal * 1_000_000_000 : $now;
            $intent = (string)($entry['intent'] ?? 'intent');
            $tags = is_array($entry['tags'] ?? null) ? $entry['tags'] : [];
            $error = (string)($entry['error'] ?? ($tags['error_class'] ?? ''));
            $severityNumber = $error !== '' ? 17 : 9; // ERROR vs INFO
            $severityText = $error !== '' ? 'ERROR' : 'INFO';

            $attrs = [
                'intent' => $intent,
                'action' => (string)($tags['action'] ?? ''),
                'tenant' => (string)($tags['tenant'] ?? ''),
                'algorithm' => (string)($tags['algorithm'] ?? ''),
                'route' => (string)($tags['route'] ?? ''),
                'decision' => (string)($tags['decision'] ?? ($entry['decision'] ?? '')),
                'result' => (string)($tags['result'] ?? ''),
                'service' => (string)($tags['service'] ?? $serviceName),
                'region' => (string)($tags['region'] ?? ''),
                'workload' => (string)($tags['workload'] ?? ''),
                'source' => (string)($tags['source'] ?? ''),
                'governance_id' => (string)($tags['governance_id'] ?? ($entry['governance_id'] ?? '')),
                'approval_status' => (string)($tags['approval_status'] ?? ($entry['approval_status'] ?? '')),
                'kms_client' => (string)($tags['kms_client'] ?? ($entry['kms_client'] ?? '')),
                'cipher_suite' => (string)($tags['cipher_suite'] ?? ($entry['cipher_suite'] ?? '')),
                'db_hook' => (string)($tags['db_hook'] ?? ($entry['db_hook'] ?? '')),
            ];
            if ($error !== '') {
                $attrs['error'] = $error;
            }

            $logRecords[] = [
                'timeUnixNano' => $ts,
                'observedTimeUnixNano' => $ts,
                'severityNumber' => $severityNumber,
                'severityText' => $severityText,
                'body' => ['stringValue' => $intent],
                'attributes' => self::attributes(array_filter($attrs, static fn($v) => $v !== '')),
            ];
        }

        return [
            'resourceLogs' => [
                [
                    'resource' => [
                        'attributes' => self::attributes([
                            'service.name' => $serviceName,
                        ]),
                    ],
                    'scopeLogs' => [
                        [
                            'scope' => [
                                'name' => $scopeName,
                                'version' => '1.0.0',
                            ],
                            'logRecords' => $logRecords,
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    public static function queueMetrics(?WrapQueueInterface $queue, int $peekLimit = 50): array
    {
        if ($queue === null) {
            return [
                'backlog' => 0,
                'oldest_age_seconds' => 0,
                'sample_contexts' => [],
                'failed' => 0,
                'failed_contexts' => [],
                'last_errors' => [],
                'sampled' => 0,
            ];
        }
        $size = $queue->size();
        $jobs = $queue->peek(min($peekLimit, max(1, $size)));
        $oldest = null;
        $contexts = [];
        $failed = 0;
        $failedContexts = [];
        $lastErrors = [];
        /** @var WrapJob $job */
        foreach ($jobs as $job) {
            $contexts[$job->context] = ($contexts[$job->context] ?? 0) + 1;
            $oldest = $oldest === null ? $job->enqueuedAt : min($oldest, $job->enqueuedAt);
            $isFailed = $job->attempts > 0 || $job->lastError !== null;
            if ($isFailed) {
                $failed++;
                $failedContexts[$job->context] = ($failedContexts[$job->context] ?? 0) + 1;
                if ($job->lastError !== null) {
                    if (count($lastErrors) < 5) {
                        $lastErrors[] = [
                            'context' => $job->context,
                            'error' => $job->lastError,
                            'at' => $job->lastErrorAt,
                        ];
                    }
                }
            }
        }
        return [
            'backlog' => $size,
            'oldest_age_seconds' => $oldest ? max(0, time() - $oldest) : 0,
            'sample_contexts' => $contexts,
            'failed' => $failed,
            'failed_contexts' => $failedContexts,
            'last_errors' => $lastErrors,
            'sampled' => count($jobs),
        ];
    }

    private static function escapeLabel(string $value): string
    {
        return str_replace(['\\', '"', "\n"], ['\\\\', '\"', ''], $value);
    }

    /**
     * Normalize a KMS client entry into a consistent shape.
     *
     * @param array<string,mixed> $entry
     * @return array<string,mixed>
     */
    private static function enrichKmsClient(array $entry): array
    {
        $clientId = (string)($entry['client'] ?? 'unknown');
        $statusData = $entry['status'] ?? [];
        $status = is_array($statusData)
            ? (string)($statusData['status'] ?? 'unknown')
            : (string)$statusData;
        $config = is_array($entry['config'] ?? null) ? $entry['config'] : [];
        $crypto = is_array($entry['crypto'] ?? null) ? $entry['crypto'] : [];

        $suspended = (bool)($entry['suspended'] ?? ($statusData['suspended'] ?? false));
        $details = array_filter([
            'status' => $statusData['status'] ?? null,
            'status_data' => $statusData['data'] ?? null,
            'suspended' => $suspended,
            'suspend_state' => $statusData['suspend_state'] ?? null,
            'suspend_reason' => $statusData['suspend_reason'] ?? null,
            'latency_ms' => $statusData['latency_ms'] ?? ($crypto['latency_ms'] ?? null),
            'request_timeout_ms' => $config['request_timeout_ms'] ?? null,
            'allowed_cipher_suites' => $config['allowed_cipher_suites'] ?? null,
            'preferred_cipher_suite' => $config['preferred_cipher_suite'] ?? null,
            'cipher_suite' => $crypto['cipher_suite'] ?? null,
            'auth_mode' => $config['auth_mode'] ?? ($crypto['auth_mode'] ?? null),
            'tag_length' => $crypto['tag_length'] ?? null,
            'nonce_length' => $crypto['nonce_length'] ?? null,
            'key_version' => $crypto['key_version'] ?? null,
        ], static fn($v) => $v !== null);

        return [
            'id' => $clientId,
            'status' => $status,
            'details' => $details,
            'suspended' => $suspended,
        ];
    }

    /**
     * @param array<string,string> $attrs
     * @return array<int,array<string,mixed>>
     */
    private static function attributes(array $attrs): array
    {
        $out = [];
        foreach ($attrs as $key => $value) {
            $out[] = [
                'key' => (string)$key,
                'value' => ['stringValue' => (string)$value],
            ];
        }
        return $out;
    }

    /**
     * @param array<string,string|int|float> $attrs
     * @return array<string,mixed>
     */
    private static function numberDataPoint(int|float $value, int $ts, array $attrs = []): array
    {
        $attrList = [];
        foreach ($attrs as $key => $attrValue) {
            $attrList[] = [
                'key' => (string)$key,
                'value' => is_int($attrValue)
                    ? ['intValue' => $attrValue]
                    : ['stringValue' => (string)$attrValue],
            ];
        }
        return [
            'timeUnixNano' => $ts,
            'asDouble' => (float)$value,
            'attributes' => $attrList,
        ];
    }

    /**
     * @param array<string,string> $attrs
     * @return array<string,mixed>
     */
    private static function gaugeMetric(string $name, string $description, int|float $value, int $ts, array $attrs = []): array
    {
        return [
            'name' => $name,
            'description' => $description,
            'unit' => '1',
            'gauge' => [
                'dataPoints' => [
                    self::numberDataPoint($value, $ts, $attrs),
                ],
            ],
        ];
    }
}
