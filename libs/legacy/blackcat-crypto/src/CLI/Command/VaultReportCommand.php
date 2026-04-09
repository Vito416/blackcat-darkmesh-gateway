<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;

final class VaultReportCommand implements CommandInterface
{
    public function name(): string
    {
        return 'vault:report';
    }

    public function description(): string
    {
        return 'Aggregate metadata (contexts, key versions) across a vault directory.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$options, $paths] = $this->parseArgs($args);
        if ($paths === []) {
            fwrite(STDERR, "Usage: vault:report [--json] [--manifest=path] [--fail-on-unused] [--fail-on-missing] [--trace] <directory> [...]\n");
            return 1;
        }

        $manifest = $this->loadManifest($options['manifest'] ?? '');
        $result = [
            'files' => 0,
            'contexts' => [],
            'key_versions' => [],
            'missing_meta' => 0,
            'unknown_contexts' => [],
            'unused_manifest_contexts' => [],
            'files_by_context' => [],
            'trace' => [],
        ];

        foreach ($paths as $dir) {
            $files = glob(rtrim($dir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . '*.enc');
            if (!$files) continue;

            foreach ($files as $file) {
                $result['files'] += 1;
                $metaPath = $file . '.meta';
                $traceEntry = [
                    'file' => $file,
                    'context' => null,
                    'key_version' => null,
                    'manifest_hit' => null,
                    'missing_meta' => false,
                    'unknown_context' => false,
                ];
                if (!is_file($metaPath)) {
                    $result['missing_meta'] += 1;
                    $traceEntry['missing_meta'] = true;
                    if (!empty($options['trace'])) {
                        $result['trace'][] = $traceEntry;
                    }
                    continue;
                }
                $meta = json_decode((string)@file_get_contents($metaPath), true);
                if (!is_array($meta)) {
                    $result['missing_meta'] += 1;
                    $traceEntry['missing_meta'] = true;
                    if (!empty($options['trace'])) {
                        $result['trace'][] = $traceEntry;
                    }
                    continue;
                }
                $context = (string)($meta['context'] ?? '');
                $keyVersion = (string)($meta['key_version'] ?? '');
                $traceEntry['context'] = $context;
                $traceEntry['key_version'] = $keyVersion;
                $result['contexts'][$context] = ($result['contexts'][$context] ?? 0) + 1;
                $result['key_versions'][$keyVersion] = ($result['key_versions'][$keyVersion] ?? 0) + 1;
                $result['files_by_context'][$context][] = $file;

                if (($context === '' || $keyVersion === '')) {
                    $result['missing_meta'] += 1;
                    $traceEntry['missing_meta'] = true;
                }
                if ($manifest !== [] && $context !== '' && !in_array($context, $manifest, true)) {
                    $result['unknown_contexts'][$context] = ($result['unknown_contexts'][$context] ?? 0) + 1;
                    $traceEntry['unknown_context'] = true;
                }
                if ($manifest !== []) {
                    $traceEntry['manifest_hit'] = in_array($context, $manifest, true);
                }
                if (!empty($options['trace'])) {
                    $result['trace'][] = $traceEntry;
                }
            }
        }

        if ($manifest !== []) {
            $present = array_keys($result['contexts']);
            $result['unused_manifest_contexts'] = array_values(array_diff($manifest, $present));
            $unusedCount = count($result['unused_manifest_contexts']);
            if (!empty($options['fail-on-unused']) && $unusedCount > 0) {
                fwrite(STDERR, "Manifest contexts not used: " . implode(', ', $result['unused_manifest_contexts']) . "\n");
            }
        }

        if (!empty($options['json'])) {
            echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        } else {
            echo "Vault report\n";
            echo "Files scanned: {$result['files']}\n";
            echo "Missing metadata: {$result['missing_meta']}\n";
            echo "Contexts:\n";
            foreach ($result['contexts'] as $context => $count) {
                echo sprintf("  %s (%d)\n", $context ?: '(missing)', $count);
            }
            echo "Key versions:\n";
            foreach ($result['key_versions'] as $version => $count) {
                echo sprintf("  %s (%d)\n", $version ?: '(missing)', $count);
            }
            if (!empty($result['unknown_contexts'])) {
                echo "Unknown contexts (not in manifest):\n";
                foreach ($result['unknown_contexts'] as $context => $count) {
                    echo sprintf("  %s (%d)\n", $context, $count);
                }
            }
            if (!empty($result['unused_manifest_contexts'])) {
                echo "Manifest contexts not present in vault:\n";
                foreach ($result['unused_manifest_contexts'] as $context) {
                    echo sprintf("  %s\n", $context);
                }
            }
            if (!empty($options['trace']) && !empty($result['trace'])) {
                echo "Trace:\n";
                foreach ($result['trace'] as $entry) {
                    $ctx = $entry['context'] ?: '(missing)';
                    $kv = $entry['key_version'] ?: '(missing)';
                    $flags = [];
                    if ($entry['missing_meta']) $flags[] = 'missing_meta';
                    if ($entry['unknown_context']) $flags[] = 'unknown_context';
                    $flagText = $flags ? ' [' . implode(',', $flags) . ']' : '';
                    echo sprintf("  %s => %s (key=%s)%s\n", $entry['file'], $ctx, $kv, $flagText);
                }
            }
        }

        $exit = 0;
        if (!empty($options['fail-on-missing']) && $result['missing_meta'] > 0) {
            $exit = 3;
        } elseif (!empty($options['fail-on-unused']) && !empty($result['unused_manifest_contexts'])) {
            $exit = 2;
        }
        return $exit;
    }

    /**
     * @param list<string> $args
     * @return array{0:array<string,string>,1:list<string>}
     */
    private function parseArgs(array $args): array
    {
        $options = [];
        $paths = [];
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--')) {
                [$key, $value] = array_pad(explode('=', substr($arg, 2), 2), 2, '1');
                if (in_array($key, ['json', 'fail-on-unused', 'fail-on-missing', 'trace'], true)) {
                    $options[$key] = ($value === '0') ? false : true;
                } else {
                    $options[$key] = $value;
                }
            } else {
                $paths[] = $arg;
            }
        }
        return [$options, $paths];
    }

    /**
     * @return list<string>
     */
    private function loadManifest(string $path): array
    {
        $path = trim($path);
        if ($path === '') {
            try {
                $cfg = CryptoConfig::fromRuntimeConfig();
                $path = (string)($cfg->manifestPath() ?? '');
            } catch (\Throwable) {
                $path = '';
            }
        }
        if ($path === '' || !is_file($path)) {
            return [];
        }
        $json = json_decode((string)@file_get_contents($path), true);
        if (!is_array($json) || !isset($json['slots']) || !is_array($json['slots'])) {
            return [];
        }
        return array_keys($json['slots']);
    }
}
