<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;

final class ManifestShowCommand implements CommandInterface
{
    public function name(): string
    {
        return 'manifest:show';
    }

    public function description(): string
    {
        return 'Print loaded manifest (slots + rotation policies) or write it to disk.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $manifestOverride = null;
        $outputPath = null;
        foreach ($args as $arg) {
            if (str_starts_with($arg, '--manifest=')) {
                $manifestOverride = substr($arg, 11);
            } elseif (str_starts_with($arg, '--output=')) {
                $outputPath = substr($arg, 9);
            } elseif (str_starts_with($arg, '--')) {
                fwrite(STDERR, "Unknown option {$arg}\n");
                return 1;
            }
        }

        $manifestPath = null;
        if (is_string($manifestOverride) && trim($manifestOverride) !== '') {
            $manifestPath = trim($manifestOverride);
        } else {
            try {
                $cfg = CryptoConfig::fromRuntimeConfig();
                $manifestPath = $cfg->manifestPath();
            } catch (\Throwable) {
                $manifestPath = null;
            }
        }

        if (!is_string($manifestPath) || $manifestPath === '' || !is_file($manifestPath)) {
            fwrite(STDERR, "Manifest not found. Provide --manifest=path or set runtime config crypto.manifest.\n");
            return 1;
        }

        $raw = file_get_contents($manifestPath);
        if ($raw === false) {
            fwrite(STDERR, "Failed to read manifest: {$manifestPath}\n");
            return 1;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            fwrite(STDERR, "Manifest is not valid JSON: {$manifestPath}\n");
            return 1;
        }

        $payload = [
            'manifest' => $manifestPath,
            'slots' => is_array($decoded['slots'] ?? null) ? $decoded['slots'] : [],
            'rotation' => is_array($decoded['rotation'] ?? null) ? $decoded['rotation'] : [],
        ];

        $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        if ($outputPath) {
            file_put_contents($outputPath, $json);
            echo "Manifest exported to {$outputPath}\n";
        } else {
            echo $json;
        }
        return 0;
    }
}
