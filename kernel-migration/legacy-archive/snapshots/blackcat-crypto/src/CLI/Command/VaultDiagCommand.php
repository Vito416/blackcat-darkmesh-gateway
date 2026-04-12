<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;

final class VaultDiagCommand implements CommandInterface
{
    private const STATUS_OK = 'ok';
    private const STATUS_WARN = 'warn';

    public function name(): string
    {
        return 'vault:diag';
    }

    public function description(): string
    {
        return 'Inspect legacy FileVault payloads (.enc) and report metadata / format status.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$options, $paths] = $this->parseArgs($args);
        if ($paths === []) {
            fwrite(STDERR, "Usage: vault:diag [--json] [--manifest=path] [--fail-on-warn] [--inline-meta] <file|directory> [...]\n");
            return 1;
        }

        $targets = $this->collectTargets($paths);
        if ($targets === []) {
            fwrite(STDERR, "No .enc files found.\n");
            return 1;
        }

        $inlineMeta = !empty($options['inline-meta']);
        $manifest = $this->loadManifest($options['manifest'] ?? '');
        $results = [];
        foreach ($targets as $file) {
            $result = $this->inspectFile($file);
            $result['path'] = $file;
            $result['reason'] = $result['reason'] ?? [];
            if ($manifest !== [] && isset($result['context']) && $result['context'] !== '') {
                if (!in_array($result['context'], $manifest, true)) {
                    $result['status'] = self::STATUS_WARN;
                    $result['reason'][] = 'unknown-context';
                }
            }
            if ($manifest !== [] && empty($result['context'])) {
                $result['status'] = self::STATUS_WARN;
                $result['reason'][] = 'missing-context';
            }
            $results[] = $result;
        }

        $summary = $this->renderResults($results, !empty($options['json']), $inlineMeta);
        $warn = $summary['warnings'];
        $exit = ($warn > 0 && !empty($options['fail-on-warn'])) ? 2 : 0;
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
                if ($key === 'manifest' && $value === '1') {
                    $value = $this->defaultManifestPath();
                }
                if ($key === 'manifest' && $value === '') {
                    $value = $this->defaultManifestPath();
                }
                if ($key === 'inline-meta') {
                    $value = '1';
                }
                $options[$key] = $value;
            } else {
                $paths[] = $arg;
            }
        }
        return [$options, $paths];
    }

    /**
     * @param list<string> $paths
     * @return list<string>
     */
    private function collectTargets(array $paths): array
    {
        $files = [];
        foreach ($paths as $path) {
            if (is_dir($path)) {
                $items = glob(rtrim($path, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . '*.enc');
                if ($items) {
                    $files = array_merge($files, $items);
                }
            } elseif (is_file($path)) {
                $files[] = $path;
            }
        }

        sort($files);
        return array_values(array_unique($files));
    }

    /**
     * @return list<string>
     */
    private function loadManifest(string $path): array
    {
        $path = trim($path);
        if ($path === '') {
            $path = $this->defaultManifestPath();
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

    private function defaultManifestPath(): string
    {
        try {
            $cfg = CryptoConfig::fromRuntimeConfig();
            return (string)($cfg->manifestPath() ?? '');
        } catch (\Throwable) {
            return '';
        }
    }

    /**
     * @return array{status:string,version?:string,key_version?:string,context?:string,meta?:string,reason?:list<string>}
     */
    private function inspectFile(string $path): array
    {
        $result = [
            'status' => self::STATUS_WARN,
            'reason' => [],
        ];

        $payload = @file_get_contents($path);
        if ($payload === false || $payload === '') {
            $result['reason'][] = 'empty-file';
            return $result;
        }

        $ptr = 0;
        $len = strlen($payload);
        $version = ord($payload[$ptr++]);
        $result['version'] = (string)$version;
        if (!in_array($version, [1, 2], true)) {
            $result['reason'][] = 'unsupported-version';
            return $result;
        }

        $keyId = null;
        if ($version === 2) {
            $keyIdLen = ord($payload[$ptr++]);
            if ($ptr + $keyIdLen > $len) {
                $result['reason'][] = 'invalid-key-id';
                return $result;
            }
            $keyId = $keyIdLen > 0 ? substr($payload, $ptr, $keyIdLen) : null;
            $ptr += $keyIdLen;
        }

        if ($ptr >= $len) {
            $result['reason'][] = 'truncated';
            return $result;
        }

        $nonceLen = ord($payload[$ptr++]);
        if ($ptr + $nonceLen > $len) {
            $result['reason'][] = 'invalid-nonce';
            return $result;
        }
        $ptr += $nonceLen;
        if ($ptr >= $len) {
            $result['reason'][] = 'truncated';
            return $result;
        }
        $tagLen = ord($payload[$ptr++]);

        $metaPath = $path . '.meta';
        $result['meta'] = is_file($metaPath) ? 'ok' : 'missing';
        if (is_file($metaPath)) {
            $meta = json_decode((string)@file_get_contents($metaPath), true);
            if (is_array($meta)) {
                $result['key_version'] = (string)($meta['key_version'] ?? '');
                $result['context'] = (string)($meta['context'] ?? '');
            }
        }

        $result['key_id'] = $keyId;
        $result['status'] = self::STATUS_OK;
        $result['mode'] = $tagLen === 0 ? 'stream' : 'single';
        return $result;
    }

    /**
     * @param list<array<string,mixed>> $results
     * @return array{warnings:int,ok:int}
     */
    private function renderResults(array $results, bool $asJson, bool $inlineMeta): array
    {
        $ok = 0;
        $warn = 0;
        if ($asJson) {
            echo json_encode([
                'files' => $results,
                'summary' => [
                    'ok' => count(array_filter($results, fn ($r) => $r['status'] === self::STATUS_OK)),
                    'warnings' => count(array_filter($results, fn ($r) => $r['status'] === self::STATUS_WARN)),
                ],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        } else {
            foreach ($results as $result) {
                $status = strtoupper($result['status']);
                if ($inlineMeta) {
                    $metaPath = $result['path'] . '.meta';
                    $meta = is_file($metaPath) ? (string)file_get_contents($metaPath) : '';
                    echo json_encode([
                        'status' => $status,
                        'file' => $result['path'],
                        'metadata' => $meta ? json_decode($meta, true) : null,
                        'reasons' => $result['reason'],
                    ], JSON_UNESCAPED_SLASHES) . PHP_EOL;
                } else {
                    $line = sprintf(
                        "%s | %s | version=%s key=%s context=%s meta=%s%s\n",
                        $status,
                        $result['path'],
                        $result['version'] ?? '?',
                        $result['key_version'] ?? '?',
                        $result['context'] ?? '?',
                        $result['meta'] ?? 'missing',
                        !empty($result['reason']) ? ' (' . implode(',', $result['reason']) . ')' : ''
                    );
                    echo $line;
                }
                $result['status'] === self::STATUS_OK ? $ok++ : $warn++;
            }
            echo sprintf("Summary: %d ok, %d warnings\n", $ok, $warn);
        }

        return [
            'warnings' => count(array_filter($results, fn ($r) => $r['status'] === self::STATUS_WARN)),
            'ok' => count(array_filter($results, fn ($r) => $r['status'] === self::STATUS_OK)),
        ];
    }
}
