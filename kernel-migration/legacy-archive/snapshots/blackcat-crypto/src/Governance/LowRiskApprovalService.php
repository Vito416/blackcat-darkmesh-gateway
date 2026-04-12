<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Governance;

/**
 * Lightweight governance helper: decides whether an unwrap/decrypt operation
 * can auto-approve or must be escalated.
 */
final class LowRiskApprovalService
{
    public function __construct(
        private int $maxAutoAmount = 10_000,
        private string $maxSensitivity = 'low',
        /** @var array<string,array{max_amount?:int,max_sensitivity?:string,burst?:int,window?:int}> */
        private array $tenantLimits = [],
        private int $defaultBurst = 50,
        private int $defaultWindowSeconds = 60
    ) {
    }

    /**
     * @param array<string,mixed> $context
     * @return array{decision:string,reason:string,meta:array<string,mixed>}
     */
    public function assessUnwrap(array $context): array
    {
        $sensitivity = strtolower((string)($context['sensitivity'] ?? 'unknown'));
        $amount = (int)($context['amount'] ?? 0);
        $tenant = (string)($context['tenant'] ?? 'unknown');

        $limits = $this->limitsForTenant($tenant);
        $rate = $this->rateCheck($tenant, $limits['burst'], $limits['window']);
        if ($rate['limited']) {
            return [
                'decision' => 'review',
                'reason' => sprintf('Rate limited: tenant=%s count=%d window=%ds', $tenant, $rate['count'], $rate['window']),
                'meta' => [
                    'limits' => $limits,
                    'rate' => $rate,
                ],
            ];
        }

        $approved = $this->isApproved($sensitivity, $amount, $limits);

        return [
            'decision' => $approved ? 'approve' : 'review',
            'reason' => $approved
                ? sprintf('Auto-approved: tenant=%s sensitivity=%s amount=%d', $tenant, $sensitivity, $amount)
                : sprintf('Requires approval: tenant=%s sensitivity=%s amount=%d', $tenant, $sensitivity, $amount),
            'meta' => [
                'limits' => $limits,
                'rate' => $rate,
            ],
        ];
    }

    /**
     * @return array{max_amount:int,max_sensitivity:string,burst:int,window:int}
     */
    private function limitsForTenant(string $tenant): array
    {
        $limits = $this->tenantLimits[$tenant] ?? [];
        return [
            'max_amount' => (int)($limits['max_amount'] ?? $this->maxAutoAmount),
            'max_sensitivity' => strtolower((string)($limits['max_sensitivity'] ?? $this->maxSensitivity)),
            'burst' => max(1, (int)($limits['burst'] ?? $this->defaultBurst)),
            'window' => max(1, (int)($limits['window'] ?? $this->defaultWindowSeconds)),
        ];
    }

    /** @param array{max_amount:int,max_sensitivity:string,burst:int,window:int} $limits */
    private function isApproved(string $sensitivity, int $amount, array $limits): bool
    {
        $rank = $this->rankSensitivity($sensitivity);
        $maxRank = $this->rankSensitivity($limits['max_sensitivity']);
        return $rank <= $maxRank && $amount <= $limits['max_amount'];
    }

    private function rankSensitivity(string $value): int
    {
        $map = [
            'low' => 1,
            'medium' => 2,
            'med' => 2,
            'high' => 3,
            'critical' => 4,
        ];
        return $map[$value] ?? 5;
    }

    /**
     * @return array{limited:bool,count:int,window:int,burst:int}
     */
    private function rateCheck(string $tenant, int $burst, int $windowSeconds): array
    {
        static $windows = [];
        $now = time();
        $state = $windows[$tenant] ?? ['start' => $now, 'count' => 0];
        if ($now - $state['start'] >= $windowSeconds) {
            $state = ['start' => $now, 'count' => 0];
        }

        $state['count']++;
        $windows[$tenant] = $state;

        $limited = $state['count'] > $burst;
        return [
            'limited' => $limited,
            'count' => $state['count'],
            'window' => $windowSeconds,
            'burst' => $burst,
        ];
    }
}
