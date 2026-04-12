<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

final class ManifestDiffCommand implements CommandInterface
{
    public function name(): string
    {
        return 'manifest:diff';
    }

    public function description(): string
    {
        return 'Compare two manifest files (slots + rotation entries).';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$options, $positionals] = $this->parseArgs($args);
        $fromPath = $options['from'] ?? $positionals[0] ?? null;
        $toPath = $options['to'] ?? $positionals[1] ?? null;
        $json = !empty($options['json']);

        if (!$fromPath || !$toPath) {
            fwrite(STDERR, "Usage: manifest:diff --from=path --to=path [--json]\n");
            return 1;
        }

        $from = $this->loadManifest($fromPath);
        $to = $this->loadManifest($toPath);

        $slotsFrom = array_keys($from['slots']);
        $slotsTo = array_keys($to['slots']);

        $diff = [
            'slots_only_in_from' => array_values(array_diff($slotsFrom, $slotsTo)),
            'slots_only_in_to' => array_values(array_diff($slotsTo, $slotsFrom)),
            'slot_changes' => $this->diffDefinitions($from['slots'], $to['slots']),
            'rotation_only_in_from' => array_values(array_diff(array_keys($from['rotation']), array_keys($to['rotation']))),
            'rotation_only_in_to' => array_values(array_diff(array_keys($to['rotation']), array_keys($from['rotation']))),
            'rotation_changes' => $this->diffDefinitions($from['rotation'], $to['rotation']),
        ];

        if ($json) {
            echo json_encode($diff, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        } else {
            $this->printDiff($diff, $fromPath, $toPath);
        }

        $hasChanges = false;
        foreach ($diff as $value) {
            if ($value !== []) {
                $hasChanges = true;
                break;
            }
        }

        return $hasChanges ? 2 : 0;
    }

    /**
     * @param list<string> $args
     * @return array{0:array<string,string>,1:list<string>}
     */
    private function parseArgs(array $args): array
    {
        $options = [];
        $positionals = [];
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--')) {
                [$key, $value] = array_pad(explode('=', substr($arg, 2), 2), 2, '1');
                $options[$key] = $value;
            } else {
                $positionals[] = $arg;
            }
        }
        return [$options, $positionals];
    }

    /**
     * @return array{slots:array<string,array<string,mixed>>,rotation:array<string,mixed>}
     */
    private function loadManifest(string $path): array
    {
        if (!is_file($path)) {
            throw new \RuntimeException('Manifest not found: ' . $path);
        }
        $data = json_decode((string)file_get_contents($path), true);
        if (!is_array($data)) {
            throw new \RuntimeException('Manifest invalid JSON: ' . $path);
        }
        return [
            'slots' => $data['slots'] ?? [],
            'rotation' => $data['rotation'] ?? [],
        ];
    }

    /**
     * @param array<string,mixed> $from
     * @param array<string,mixed> $to
     * @return array<array<string,mixed>>
     */
    private function diffDefinitions(array $from, array $to): array
    {
        $changes = [];
        foreach ($from as $key => $definition) {
            if (!array_key_exists($key, $to)) {
                continue;
            }
            $lhs = json_encode($definition);
            $rhs = json_encode($to[$key]);
            if ($lhs !== $rhs) {
                $changes[] = [
                    'key' => $key,
                    'from' => $definition,
                    'to' => $to[$key],
                ];
            }
        }
        return $changes;
    }

    /** @param array<string,mixed> $diff */
    private function printDiff(array $diff, string $from, string $to): void
    {
        echo "Manifest diff ({$from} -> {$to})\n";
        foreach (['slots_only_in_from', 'slots_only_in_to', 'rotation_only_in_from', 'rotation_only_in_to'] as $section) {
            if (!empty($diff[$section])) {
                echo strtoupper($section) . "\n";
                foreach ($diff[$section] as $value) {
                    echo "  - {$value}\n";
                }
            }
        }
        foreach (['slot_changes', 'rotation_changes'] as $section) {
            if (!empty($diff[$section])) {
                echo strtoupper($section) . "\n";
                foreach ($diff[$section] as $change) {
                    echo "  * {$change['key']}\n";
                }
            }
        }
    }
}
