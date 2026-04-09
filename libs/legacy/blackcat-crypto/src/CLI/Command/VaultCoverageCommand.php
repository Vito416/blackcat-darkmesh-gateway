<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Tracker\VaultCoverageTracker;
use RuntimeException;

final class VaultCoverageCommand implements CommandInterface
{
    public function name(): string
    {
        return 'vault:coverage';
    }

    public function description(): string
    {
        return 'Aggregate vault coverage diag/summary files (JSON or NDJSON).';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$options, $files] = $this->parseArgs($args);
        if ($files === []) {
            $files = ['-'];
        }

        $aggregate = [
            'total' => 0,
            'missingMeta' => 0,
            'contexts' => [],
        ];
        $hadInput = false;

        foreach ($files as $file) {
            try {
                $payload = $this->readInput($file);
            } catch (RuntimeException $e) {
                fwrite(STDERR, "[vault:coverage] {$e->getMessage()}\n");
                return 1;
            }

            if ($payload === null) {
                continue;
            }

            $hadInput = true;
            if ($payload['type'] === 'diag') {
                $coverage = VaultCoverageTracker::coverageFromDiag($payload['data']);
                $this->mergeCoverage($aggregate, $coverage);
            } else {
                $this->mergeCoverage($aggregate, $payload['data']);
            }
        }

        if (!$hadInput) {
            fwrite(STDERR, "[vault:coverage] no input supplied\n");
            return 1;
        }

        if ($options['table']) {
            $this->printTable($aggregate, $options['top']);
        } else {
            echo json_encode($aggregate, JSON_PRETTY_PRINT) . PHP_EOL;
        }

        return 0;
    }

    /**
     * @param list<string> $args
     * @return array{0:array{table:bool,top:int},1:list<string>}
     */
    private function parseArgs(array $args): array
    {
        $options = [
            'table' => false,
            'top' => 10,
        ];
        $files = [];

        foreach ($args as $arg) {
            if ($arg === '--table') {
                $options['table'] = true;
                continue;
            }

            if (str_starts_with($arg, '--top=')) {
                $value = (int) substr($arg, 6);
                $options['top'] = $value > 0 ? $value : 10;
                continue;
            }

            $files[] = $arg;
        }

        return [$options, $files];
    }

    /**
     * @return array{type:'diag',data:array<int,array<string,mixed>>}|array{type:'coverage',data:array<string,mixed>}|null
     */
    private function readInput(string $path): ?array
    {
        $label = $path === '-' ? 'STDIN' : $path;
        if ($path !== '-' && !is_file($path)) {
            throw new RuntimeException("File not found: {$path}");
        }

        $contents = $path === '-' ? stream_get_contents(STDIN) : file_get_contents($path);
        if ($contents === false) {
            throw new RuntimeException("Unable to read {$label}");
        }

        $trimmed = trim($contents);
        if ($trimmed === '') {
            return null;
        }

        $decoded = json_decode($trimmed, true);
        if (is_array($decoded)) {
            if ($this->looksLikeCoverage($decoded)) {
                return ['type' => 'coverage', 'data' => $decoded];
            }
            if ($this->looksLikeDiagArray($decoded)) {
                return ['type' => 'diag', 'data' => $this->normalizeDiagArray($decoded)];
            }
        }

        $entries = $this->parseNdjson($contents);
        if ($entries === []) {
            throw new RuntimeException("{$label} does not contain JSON coverage data or diag entries");
        }

        return ['type' => 'diag', 'data' => $entries];
    }

    /** @param array<string,mixed> $payload */
    private function looksLikeCoverage(array $payload): bool
    {
        return array_key_exists('total', $payload)
            && array_key_exists('missingMeta', $payload)
            && array_key_exists('contexts', $payload);
    }

    /** @param array<mixed> $payload */
    private function looksLikeDiagArray(array $payload): bool
    {
        if ($payload === []) {
            return true;
        }

        $isList = $this->isList($payload);
        if ($isList) {
            $first = $payload[0] ?? null;
            return is_array($first) && array_key_exists('context', $first);
        }

        return false;
    }

    /**
     * @param array<mixed> $payload
     * @return array<int,array<string,mixed>>
     */
    private function normalizeDiagArray(array $payload): array
    {
        $entries = [];
        foreach ($payload as $entry) {
            if (is_array($entry) && isset($entry['context'])) {
                $entries[] = $entry;
            }
        }
        return $entries;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function parseNdjson(string $contents): array
    {
        $entries = [];
        $lines = preg_split("/\r?\n/", $contents) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $decoded = json_decode($line, true);
            if (is_array($decoded) && isset($decoded['context'])) {
                $entries[] = $decoded;
            }
        }
        return $entries;
    }

    /**
     * @param array<string,mixed> $aggregate
     * @param array<string,mixed> $coverage
     */
    private function mergeCoverage(array &$aggregate, array $coverage): void
    {
        $aggregate['total'] += (int) ($coverage['total'] ?? 0);
        $aggregate['missingMeta'] += (int) ($coverage['missingMeta'] ?? 0);
        $contexts = is_array($coverage['contexts'] ?? null) ? $coverage['contexts'] : [];
        foreach ($contexts as $context => $count) {
            $aggregate['contexts'][$context] = ($aggregate['contexts'][$context] ?? 0) + (int) $count;
        }
    }

    /**
     * @param array<string,mixed> $coverage
     */
    private function printTable(array $coverage, int $top): void
    {
        $contexts = $coverage['contexts'] ?? [];
        if (!is_array($contexts)) {
            $contexts = [];
        }
        arsort($contexts);
        if ($top > 0) {
            $contexts = array_slice($contexts, 0, $top, true);
        }

        printf("%-50s %s\n", 'Context', 'Events');
        printf("%'-50s %s\n", '', '------');
        foreach ($contexts as $context => $count) {
            printf("%-50s %d\n", (string) $context, (int) $count);
        }
        printf("%'-50s %s\n", '', '------');
        printf("%-50s %d\n", 'Total events', (int) $coverage['total']);
        printf("%-50s %d\n", 'Missing metadata', (int) $coverage['missingMeta']);
    }

    /** @param array<mixed> $payload */
    private function isList(array $payload): bool
    {
        if (function_exists('array_is_list')) {
            return array_is_list($payload);
        }
        $i = 0;
        foreach ($payload as $key => $_) {
            if ($key !== $i) {
                return false;
            }
            $i++;
        }
        return true;
    }
}
