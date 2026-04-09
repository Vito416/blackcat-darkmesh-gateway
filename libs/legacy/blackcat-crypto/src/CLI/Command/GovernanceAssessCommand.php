<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Governance\LowRiskApprovalService;

final class GovernanceAssessCommand implements CommandInterface
{
    public function name(): string
    {
        return 'gov:assess';
    }

    public function description(): string
    {
        return 'Assess an unwrap/decrypt request and decide if it can auto-approve or needs review.';
    }

    /**
    * @param array<int,string> $args
    */
    public function run(array $args): int
    {
        $context = $this->parseArgs($args);
        $service = new LowRiskApprovalService();
        $result = $service->assessUnwrap($context);

        $decision = strtoupper($result['decision']);
        echo sprintf(
            "Decision: %s\nReason: %s\n",
            $decision,
            $result['reason']
        );

        // Exit code 0 for approve, 1 for review to allow automation.
        return $result['decision'] === 'approve' ? 0 : 1;
    }

    /**
     * @param array<int,string> $args
     * @return array<string,mixed>
     */
    private function parseArgs(array $args): array
    {
        $context = [
            'tenant' => null,
            'sensitivity' => null,
            'amount' => null,
        ];

        foreach ($args as $arg) {
            if (str_starts_with($arg, '--tenant=')) {
                $context['tenant'] = substr($arg, 9);
            } elseif (str_starts_with($arg, '--sensitivity=')) {
                $context['sensitivity'] = substr($arg, 14);
            } elseif (str_starts_with($arg, '--amount=')) {
                $context['amount'] = (int)substr($arg, 9);
            } elseif ($arg === '--json' || $arg === '--context') {
                // Next argument should be JSON payload
                continue;
            }
        }

        // If user provided a JSON payload as the last argument, parse it.
        $last = end($args);
        if (is_string($last) && $this->looksLikeJson($last)) {
            $decoded = json_decode($last, true);
            if (is_array($decoded)) {
                $context = array_merge($context, $decoded);
            }
        }

        return $context;
    }

    private function looksLikeJson(string $value): bool
    {
        $trim = ltrim($value);
        return $trim !== '' && ($trim[0] === '{' || $trim[0] === '[');
    }
}
