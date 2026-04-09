<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Keyring;

use BlackCat\Crypto\Contracts\KeyResolverInterface;
use BlackCat\Crypto\Support\Random;
use Psr\Log\LoggerInterface;

final class MultiSourceKeyResolver implements KeyResolverInterface
{
    private const FILE_EXT_KEY = 'key';
    private const FILE_EXT_HEX = 'hex';
    private const FILE_EXT_B64 = 'b64';

    /**
     * @param list<array<string,mixed>> $sources
     */
    public function __construct(
        private readonly array $sources,
        private readonly ?LoggerInterface $logger = null,
    ) {}

    public function resolve(KeySlot $slot, ?string $forceKeyId = null): KeyMaterial
    {
        $candidates = $this->loadAllKeys($slot);
        if ($forceKeyId !== null) {
            $found = null;
            foreach ($candidates as $candidate) {
                if ($candidate->id === $forceKeyId) {
                    // Keep the last match so source preference can win.
                    $found = $candidate;
                }
            }
            if ($found instanceof KeyMaterial) {
                return $found;
            }
        }
        return end($candidates) ?: throw new \RuntimeException("No key material for slot {$slot->name()}");
    }

    public function kmsBindings(KeySlot $slot): array
    {
        $bindings = [];
        foreach ($this->sources as $source) {
            if (($source['type'] ?? '') !== 'kms') {
                continue;
            }
            $bindings[] = new KeyMaterial(
                id: $source['id'] ?? Random::hex(8),
                bytes: $source['token'] ?? '',
                slot: $slot->name(),
                metadata: $source,
            );
        }
        return $bindings;
    }

    public function all(KeySlot $slot): array
    {
        return $this->loadAllKeys($slot);
    }

    /** @return list<KeyMaterial> */
    private function loadAllKeys(KeySlot $slot): array
    {
        $keys = [];
        foreach ($this->sources as $source) {
            $type = $source['type'] ?? 'filesystem';
            $loader = $type . 'Loader';
            if (!method_exists($this, $loader)) {
                continue;
            }
            $keys = array_merge($keys, $this->{$loader}($slot, $source));
        }
        if ($keys === []) {
            throw new \RuntimeException('No key sources yielded data');
        }

        // Ensure deterministic ordering (newest key must be last).
        usort($keys, static function (KeyMaterial $a, KeyMaterial $b): int {
            $av = self::keyVersion($a);
            $bv = self::keyVersion($b);
            if ($av !== $bv) {
                return $av <=> $bv;
            }

            $as = self::sourceWeight($a);
            $bs = self::sourceWeight($b);
            if ($as !== $bs) {
                return $as <=> $bs;
            }

            return strcmp($a->id, $b->id);
        });

        // Drop duplicates by key id (keep the preferred one after sorting).
        $byId = [];
        foreach ($keys as $mat) {
            $byId[$mat->id] = $mat;
        }
        $keys = array_values($byId);
        usort($keys, static function (KeyMaterial $a, KeyMaterial $b): int {
            $av = self::keyVersion($a);
            $bv = self::keyVersion($b);
            if ($av !== $bv) {
                return $av <=> $bv;
            }
            $as = self::sourceWeight($a);
            $bs = self::sourceWeight($b);
            if ($as !== $bs) {
                return $as <=> $bs;
            }
            return strcmp($a->id, $b->id);
        });

        return $keys;
    }

    /**
     * @param array<string,mixed> $source
     * @return list<KeyMaterial>
     */
    private function filesystemLoader(KeySlot $slot, array $source): array
    {
        $dir = $source['path'] ?? null;
        if (!$dir || !is_dir($dir)) {
            return [];
        }
        $expectedLen = $slot->length();
        $keyName = strtolower($slot->keyName());
        $variants = array_values(array_unique([
            $keyName,
            str_replace(['.', '-'], '_', $keyName),
            str_replace(['.', '-', '_'], '', $keyName),
        ]));

        $allFiles = array_merge(
            glob($dir . '/*.' . self::FILE_EXT_KEY) ?: [],
            glob($dir . '/*.' . self::FILE_EXT_HEX) ?: [],
            glob($dir . '/*.' . self::FILE_EXT_B64) ?: [],
        );

        /** @var list<array{version:int,ext:string,file:string}> $versioned */
        $versioned = [];
        foreach ($allFiles as $file) {
            $base = basename($file);
            foreach ($variants as $variant) {
                if ($variant === '') {
                    continue;
                }
                $pattern = '~^' . preg_quote($variant, '~') . '_v(?P<ver>\\d+)\\.(?P<ext>key|hex|b64)$~i';
                if (preg_match($pattern, $base, $m)) {
                    $versioned[] = [
                        'version' => (int)$m['ver'],
                        'ext' => strtolower((string)$m['ext']),
                        'file' => $file,
                    ];
                    continue 2;
                }
            }
        }

        usort(
            $versioned,
            static function (array $a, array $b): int {
                $byVer = ($a['version'] <=> $b['version']);
                if ($byVer !== 0) {
                    return $byVer;
                }
                $wa = self::extWeight((string)$a['ext']);
                $wb = self::extWeight((string)$b['ext']);
                if ($wa !== $wb) {
                    return $wa <=> $wb;
                }
                return strcmp((string)$a['file'], (string)$b['file']);
            }
        );

        $result = [];
        $seenVersions = [];
        foreach ($versioned as $entry) {
            $ver = (int)$entry['version'];
            if ($ver < 1 || isset($seenVersions[$ver])) {
                continue;
            }
            $seenVersions[$ver] = true;

            $file = (string)$entry['file'];
            $ext = strtolower((string)$entry['ext']);
            $bytes = $this->loadKeyBytesFromFile($file, $ext, $expectedLen);
            if (!is_string($bytes)) {
                continue;
            }
            $result[] = new KeyMaterial(
                id: self::canonicalKeyId($slot, $ver),
                bytes: $bytes,
                slot: $slot->name(),
                metadata: ['source' => 'filesystem', 'path' => $file, 'version' => $ver, 'ext' => $ext],
            );
        }
        return $result;
    }

    private static function canonicalKeyId(KeySlot $slot, int $version): string
    {
        $name = strtolower($slot->keyName());
        $name = preg_replace('~[^a-z0-9_.-]+~', '_', $name) ?: 'key';
        return $name . '_v' . $version . '.key';
    }

    private static function keyVersion(KeyMaterial $mat): int
    {
        $meta = $mat->metadata['version'] ?? null;
        if (is_int($meta) && $meta > 0) {
            return $meta;
        }
        if (preg_match('~_v(?P<ver>\\d+)\\b~i', $mat->id, $m)) {
            return (int)$m['ver'];
        }
        return 0;
    }

    private static function extWeight(string $ext): int
    {
        return match (strtolower($ext)) {
            self::FILE_EXT_KEY => 0,
            self::FILE_EXT_HEX => 1,
            self::FILE_EXT_B64 => 2,
            default => 99,
        };
    }

    private static function sourceWeight(KeyMaterial $mat): int
    {
        $source = $mat->metadata['source'] ?? null;
        $source = is_string($source) ? strtolower($source) : '';
        return match ($source) {
            'filesystem' => 0,
            default => 50,
        };
    }

    private function loadKeyBytesFromFile(string $file, string $ext, int $expectedLen): ?string
    {
        $raw = @file_get_contents($file);
        if ($raw === false) {
            return null;
        }

        if ($ext === self::FILE_EXT_KEY) {
            if (strlen($raw) !== $expectedLen) {
                $this->logger?->debug('filesystemLoader: invalid key length', [
                    'file' => $file,
                    'expected' => $expectedLen,
                    'got' => strlen($raw),
                ]);
                return null;
            }
            return $raw;
        }

        if ($ext === self::FILE_EXT_HEX) {
            $txt = preg_replace('~\\s+~', '', trim($raw)) ?? '';
            if ($txt === '' || (strlen($txt) % 2) !== 0 || !ctype_xdigit($txt)) {
                return null;
            }
            $bytes = @hex2bin($txt);
            if ($bytes === false || strlen($bytes) !== $expectedLen) {
                return null;
            }
            return $bytes;
        }

        if ($ext === self::FILE_EXT_B64) {
            $txt = preg_replace('~\\s+~', '', trim($raw)) ?? '';
            if ($txt === '') {
                return null;
            }
            $bytes = base64_decode($txt, true);
            if ($bytes === false || strlen($bytes) !== $expectedLen) {
                return null;
            }
            return $bytes;
        }

        return null;
    }
}
