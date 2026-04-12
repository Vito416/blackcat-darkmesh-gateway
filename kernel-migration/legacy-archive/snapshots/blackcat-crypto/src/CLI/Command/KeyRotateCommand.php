<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;
use Psr\Log\LoggerInterface;

final class KeyRotateCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string
    {
        return 'key:rotate';
    }

    public function description(): string
    {
        return 'Generate fresh key material for a slot into a directory (rotation helper).';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$options, $positionals] = $this->parseArgs($args);
        $slot = $positionals[0] ?? null;
        $target = $positionals[1] ?? null;
        $format = strtolower((string)($options['format'] ?? 'raw'));
        $manifestPath = $options['manifest'] ?? null;
        if (!is_string($manifestPath) || trim($manifestPath) === '') {
            $manifestPath = null;
            try {
                $cfg = CryptoConfig::fromRuntimeConfig();
                $manifestPath = $cfg->manifestPath();
            } catch (\Throwable) {
            }
        }
        $requestedVersion = isset($options['version']) && is_numeric($options['version']) ? (int)$options['version'] : null;
        $dryRun = array_key_exists('dry-run', $options) || array_key_exists('dry', $options);
        $jsonOut = array_key_exists('json', $options);
        $writeMeta = !array_key_exists('no-meta', $options);
        $length = $this->deriveLength($options, $manifestPath, $slot);

        $outputPath = null;
        $dir = $target;
        if (is_string($target)) {
            $base = basename($target);
            $ext = strtolower((string)pathinfo($base, PATHINFO_EXTENSION));
            if (in_array($ext, ['key', 'hex', 'b64'], true) && !is_dir($target)) {
                $outputPath = $target;
                $dir = dirname($target);
                if (!array_key_exists('format', $options)) {
                    $format = match ($ext) {
                        'hex' => 'hex',
                        'b64' => 'base64',
                        default => 'raw',
                    };
                }
                if ($requestedVersion === null && preg_match('~_v(?P<ver>\\d+)\\.(key|hex|b64)$~i', $base, $m)) {
                    $requestedVersion = (int)$m['ver'];
                }
            }
        }

        if ($manifestPath && $slot && is_file($manifestPath)) {
            $manifest = json_decode((string)file_get_contents($manifestPath), true);
            if (!isset($manifest['slots'][$slot])) {
                fwrite(STDERR, "Slot {$slot} not found in manifest {$manifestPath}\n");
                return 1;
            }
        }

        if (!in_array($format, ['raw', 'hex', 'base64'], true)) {
            fwrite(STDERR, "Invalid format {$format}; use raw|hex|base64\n");
            return 1;
        }

        if ($slot === null || $dir === null) {
            fwrite(STDERR, "Usage: key:rotate <slot> <dir|output-file> [--length=32] [--format=raw|hex|base64] [--manifest=path] [--version=N] [--dry-run] [--json] [--no-meta]\n");
            return 1;
        }

        if ($length <= 0 || ($format === 'raw' && $length < 16)) {
            fwrite(STDERR, "Length must be positive" . ($format === 'raw' ? ' (>=16 bytes for raw output)' : '') . "\n");
            return 1;
        }

        if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
            fwrite(STDERR, "Unable to create directory: {$dir}\n");
            return 1;
        }

        $keyBasename = $this->deriveKeyBasename($slot, $manifestPath);
        $version = $requestedVersion ?? $this->nextVersion($dir, $keyBasename);
        $bytes = random_bytes($length);
        [$content, $ext] = $this->formatKey($bytes, $format);
        $file = $this->buildFilename($dir, $keyBasename, $version, $ext);

        if ($outputPath !== null && $outputPath !== $file && !$jsonOut) {
            fwrite(STDERR, "Note: output filename is normalized to the standard vN naming; writing {$file}\n");
        }

        $meta = [
            'slot' => $slot,
            'key' => $keyBasename,
            'version' => $version,
            'format' => $format,
            'length' => $length,
            'manifest' => $manifestPath,
            'created_at' => date(DATE_ATOM),
            'sha256' => hash('sha256', $content),
        ];

        if (!$dryRun) {
            if (file_put_contents($file, $content) === false) {
                $this->logger->error('key-rotate-write-failed', ['slot' => $slot, 'file' => $file]);
                fwrite(STDERR, "Failed to write key file\n");
                return 1;
            }
            @chmod($file, 0600);
            if ($writeMeta) {
                $metaPath = $file . '.meta.json';
                file_put_contents($metaPath, json_encode($meta, JSON_PRETTY_PRINT));
                @chmod($metaPath, 0600);
            }
        }

        $this->logger->info('key-rotated', ['slot' => $slot, 'file' => $file, 'length' => $length, 'format' => $format, 'version' => $version, 'dry_run' => $dryRun]);
        $output = [
            'slot' => $slot,
            'version' => $version,
            'file' => $file,
            'length' => $length,
            'format' => $format,
            'dry_run' => $dryRun,
        ];
        if ($jsonOut) {
            echo json_encode($output, JSON_PRETTY_PRINT) . "\n";
        } else {
            $note = $dryRun ? 'DRY-RUN' : 'OK';
            echo "[{$note}] Rotated {$slot} -> {$file} (v{$version}, {$length} bytes, {$format})\n";
        }
        return 0;
    }

    /**
     * @param array<int,string> $args
     * @return array{0:array<string,mixed>,1:array<int,string>}
     */
    private function parseArgs(array $args): array
    {
        $options = [];
        $positionals = [];
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--')) {
                [$key, $value] = array_pad(explode('=', substr($arg, 2), 2), 2, true);
                $options[$key] = $value;
            } else {
                $positionals[] = $arg;
            }
        }
        return [$options, $positionals];
    }

    private function buildFilename(string $dir, string $keyBasename, int $version, string $ext = 'key'): string
    {
        $safeKey = preg_replace('~[^A-Za-z0-9_.-]+~', '_', $keyBasename) ?: 'key';
        return rtrim($dir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . "{$safeKey}_v{$version}.{$ext}";
    }

    /**
     * @return array{0:string,1:string}
     */
    private function formatKey(string $bytes, string $format): array
    {
        return match ($format) {
            'hex' => [bin2hex($bytes), 'hex'],
            'base64' => [base64_encode($bytes), 'b64'],
            default => [$bytes, 'key'],
        };
    }

    /**
     * @param array<string,mixed> $options
     */
    private function deriveLength(array $options, ?string $manifestPath, ?string $slot): int
    {
        if (isset($options['length']) && is_numeric($options['length'])) {
            return (int)$options['length'];
        }

        if ($manifestPath && $slot && is_file($manifestPath)) {
            $manifest = json_decode((string)file_get_contents($manifestPath), true);
            $slotDef = $manifest['slots'][$slot] ?? null;
            if (is_array($slotDef) && isset($slotDef['length']) && is_int($slotDef['length'])) {
                return $slotDef['length'];
            }
        }

        return 32;
    }

    private function nextVersion(string $dir, string $keyBasename): int
    {
        if (!is_dir($dir)) {
            return 1;
        }
        $safeKey = preg_replace('~[^A-Za-z0-9_.-]+~', '_', $keyBasename) ?: $keyBasename;
        $pattern = rtrim($dir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $safeKey . '_v*.*';
        $max = 0;
        foreach (glob($pattern) ?: [] as $file) {
            $base = basename($file);
            $re = '~^' . preg_quote($safeKey, '~') . '_v(?P<ver>\\d+)(?:_.*)?\\.(key|hex|b64)$~i';
            if (preg_match($re, $base, $m)) {
                $max = max($max, (int)$m['ver']);
            }
        }
        return $max + 1;
    }

    private function deriveKeyBasename(string $slot, ?string $manifestPath): string
    {
        $base = $slot;
        if ($manifestPath && is_file($manifestPath)) {
            $manifest = json_decode((string)file_get_contents($manifestPath), true);
            $slotDef = $manifest['slots'][$slot] ?? null;
            if (is_array($slotDef) && isset($slotDef['key']) && is_string($slotDef['key']) && $slotDef['key'] !== '') {
                $base = $slotDef['key'];
            }
        }

        return preg_replace('~[^A-Za-z0-9_.-]+~', '_', $base) ?: 'key';
    }
}
