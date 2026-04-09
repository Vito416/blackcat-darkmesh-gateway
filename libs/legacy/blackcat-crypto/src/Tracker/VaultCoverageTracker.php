<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Tracker;

final class VaultCoverageTracker
{
    /**
     * Generate coverage stats from vault:diag JSON output (list of files).
     *
     * @param array<int,array<string,mixed>> $items
     * @return array<string,mixed>
     */
    public static function coverageFromDiag(array $items): array
    {
        $contexts = [];
        $missingMeta = 0;
        foreach ($items as $item) {
            $context = (string)($item['context'] ?? '');
            $contexts[$context] = ($contexts[$context] ?? 0) + 1;
            if (($item['meta'] ?? 'missing') !== 'ok') {
                $missingMeta += 1;
            }
        }

        return [
            'total' => count($items),
            'contexts' => $contexts,
            'missingMeta' => $missingMeta,
        ];
    }
}
