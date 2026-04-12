<?php

declare(strict_types=1);

namespace BlackCat\Crypto\Governance;

use BlackCat\Crypto\Telemetry\IntentCollector;
use InvalidArgumentException;

/**
 * Lightweight approval inbox for unwrap/governance intents.
 * Queues approvals, emits telemetry when queued/approved/denied,
 * and keeps an in-memory view suitable for CLI or short-lived workers.
 */
final class ApprovalInbox
{
    private GovernanceReporter $reporter;

    /** @var array<string,array<string,mixed>> */
    private array $items = [];

    public function __construct(?GovernanceReporter $reporter = null, ?IntentCollector $collector = null)
    {
        $collector = $collector ?? IntentCollector::global();
        $this->reporter = $reporter ?? new GovernanceReporter($collector);
    }

    /**
     * Queue a new approval request.
     *
     * @param array<string,mixed> $ctx
     * @return string approval id
     */
    public function enqueue(array $ctx): string
    {
        $id = $ctx['approval_id'] ?? bin2hex(random_bytes(8));
        $record = [
            'approval_id' => $id,
            'request_id' => $ctx['request_id'] ?? null,
            'risk' => $ctx['risk'] ?? null,
            'reason' => $ctx['reason'] ?? null,
            'env' => $ctx['env'] ?? null,
            'product' => $ctx['product'] ?? null,
            'governance_id' => $ctx['governance_id'] ?? null,
            'approval_status' => 'queued',
            'result' => 'queued',
            'queued_at' => $ctx['queued_at'] ?? microtime(true),
        ];

        $this->items[$id] = $record;
        $this->reporter->queued($record);

        return $id;
    }

    /**
     * Mark an approval as granted and emit telemetry.
     *
     * @param array<string,mixed> $ctx
     * @return array<string,mixed>
     */
    public function approve(string $approvalId, array $ctx = []): array
    {
        $item = $this->get($approvalId);
        $item['approval_status'] = 'approved';
        $item['result'] = 'ok';
        $item['approved_at'] = $ctx['approved_at'] ?? microtime(true);
        $item = array_merge($item, $ctx);

        $this->items[$approvalId] = $item;
        $this->reporter->approved($item);

        return $item;
    }

    /**
     * Mark an approval as rejected and emit telemetry.
     *
     * @param array<string,mixed> $ctx
     * @return array<string,mixed>
     */
    public function deny(string $approvalId, array $ctx = []): array
    {
        $item = $this->get($approvalId);
        $item['approval_status'] = 'denied';
        $item['result'] = 'rejected';
        $item['denied_at'] = $ctx['denied_at'] ?? microtime(true);
        $item = array_merge($item, $ctx);

        $this->items[$approvalId] = $item;
        $this->reporter->denied($item);

        return $item;
    }

    /**
     * Return all queued approvals.
     *
     * @return array<string,array<string,mixed>>
     */
    public function pending(): array
    {
        return array_filter(
            $this->items,
            static fn (array $item): bool => ($item['approval_status'] ?? null) === 'queued'
        );
    }

    /**
     * Return all approvals (any status).
     *
     * @return array<string,array<string,mixed>>
     */
    public function all(): array
    {
        return $this->items;
    }

    /** @return array<string,mixed> */
    private function get(string $approvalId): array
    {
        if (!isset($this->items[$approvalId])) {
            throw new InvalidArgumentException("Unknown approval id '{$approvalId}'");
        }

        return $this->items[$approvalId];
    }
}
