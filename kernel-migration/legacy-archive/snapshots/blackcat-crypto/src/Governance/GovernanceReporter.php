<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Governance;

use BlackCat\Crypto\Telemetry\IntentCollector;

/**
 * Lightweight reporter that emits governance-related intents into the global
 * telemetry stream (for audit/export via TelemetryExporter).
 */
final class GovernanceReporter
{
    public function __construct(private ?IntentCollector $collector = null)
    {
    }

    /** @param array<string,mixed> $ctx */
    public function approved(array $ctx): void
    {
        $this->record('approved', $ctx);
    }

    /** @param array<string,mixed> $ctx */
    public function denied(array $ctx): void
    {
        $this->record('denied', $ctx);
    }

    /** @param array<string,mixed> $ctx */
    public function queued(array $ctx): void
    {
        $this->record('queued', $ctx);
    }

    /** @param array<string,mixed> $ctx */
    private function record(string $decision, array $ctx): void
    {
        $collector = IntentCollector::global();
        if ($collector === null) {
            $collector = $this->collector ?? new IntentCollector();
            IntentCollector::global($collector);
        }
        $this->collector = $collector;

        $collector->record('governance.unwrap', [
            'action' => 'unwrap',
            'decision' => $decision,
            'policy' => $ctx['policy'] ?? null,
            'tenant' => $ctx['tenant'] ?? null,
            'algorithm' => $ctx['algorithm'] ?? null,
            'route' => $ctx['route'] ?? null,
            'service' => $ctx['service'] ?? 'governance',
            'workload' => $ctx['workload'] ?? null,
            'region' => $ctx['region'] ?? null,
            'approval_id' => $ctx['approval_id'] ?? null,
            'request_id' => $ctx['request_id'] ?? null,
            'risk' => $ctx['risk'] ?? null,
            'reason' => $ctx['reason'] ?? null,
            'result' => $decision === 'approved' ? 'ok' : ($decision === 'denied' ? 'rejected' : 'queued'),
            'approval_status' => $decision,
            'env' => $ctx['env'] ?? null,
            'product' => $ctx['product'] ?? null,
            'governance_id' => $ctx['governance_id'] ?? null,
        ]);
    }
}
