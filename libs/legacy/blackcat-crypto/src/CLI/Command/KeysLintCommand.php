<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Config\CryptoConfig;

final class KeysLintCommand implements CommandInterface
{
    private const EXT_KEY = 'key';
    private const EXT_HEX = 'hex';
    private const EXT_B64 = 'b64';

    public function name(): string
    {
        return 'keys:lint';
    }

    public function description(): string
    {
        return 'Lint keys directory against a manifest (presence + decoding + length).';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$options, $positionals] = $this->parseArgs($args);
        $json = array_key_exists('json', $options);
        $failOnWarn = array_key_exists('fail-on-warn', $options);
        $warnExtra = array_key_exists('warn-extra', $options);

        $manifestPath = $options['manifest'] ?? null;
        $keysDir = $options['keys-dir'] ?? $options['keys_dir'] ?? null;

        // Prefer runtime config (fail-closed default).
        try {
            $cfg = CryptoConfig::fromRuntimeConfig();
            if ($manifestPath === null) {
                $manifestPath = $cfg->manifestPath();
            }
            if ($keysDir === null) {
                foreach ($cfg->keySources() as $source) {
                    if (($source['type'] ?? '') === 'filesystem') {
                        $p = $source['path'] ?? null;
                        if (is_string($p) && trim($p) !== '') {
                            $keysDir = trim($p);
                            break;
                        }
                    }
                }
            }
        } catch (\Throwable) {
            // Intentionally ignore here; usage errors are reported below.
        }

        if ($manifestPath === null || $keysDir === null) {
            if ($json) {
                echo json_encode([
                    'ok' => false,
                    'errors' => ['Usage: keys:lint --manifest=path --keys-dir=path [--json] [--warn-extra] [--fail-on-warn]'],
                    'warnings' => [],
                ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
                return 1;
            }
            fwrite(STDERR, "Usage: keys:lint --manifest=path --keys-dir=path [--json] [--warn-extra] [--fail-on-warn]\n");
            return 1;
        }

        $report = $this->lint($manifestPath, $keysDir, $warnExtra);

        if ($json) {
            echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        } else {
            $this->printHuman($report);
        }

        if ($report['errors'] !== []) {
            return 1;
        }
        if ($failOnWarn && $report['warnings'] !== []) {
            return 1;
        }
        return 0;
    }

    /**
     * @param array<int,string> $args
     * @return array{0:array<string,mixed>,1:list<string>}
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

    /**
     * @return array{
     *   ok:bool,
     *   manifest:string,
     *   keys_dir:string,
     *   errors:list<string>,
     *   warnings:list<string>,
     *   slots:array<string,array{
     *     slot:string,
     *     key:?string,
     *     length:?int,
     *     matched_files:list<string>,
     *     valid_keys:list<array{file:string,version:int,ext:string,bytes:int}>,
     *     invalid_files:list<array{file:string,reason:string}>,
     *   }>,
     *   extra_key_files?:list<string>
     * }
     */
    private function lint(string $manifestPath, string $keysDir, bool $warnExtra): array
    {
        $errors = [];
        $warnings = [];
        $slotsReport = [];

        if (!is_file($manifestPath) || !is_readable($manifestPath)) {
            $errors[] = 'Manifest is not readable: ' . $manifestPath;
            return [
                'ok' => false,
                'manifest' => $manifestPath,
                'keys_dir' => $keysDir,
                'errors' => $errors,
                'warnings' => $warnings,
                'slots' => [],
            ];
        }

        $raw = file_get_contents($manifestPath);
        if ($raw === false) {
            $errors[] = 'Failed to read manifest: ' . $manifestPath;
            return [
                'ok' => false,
                'manifest' => $manifestPath,
                'keys_dir' => $keysDir,
                'errors' => $errors,
                'warnings' => $warnings,
                'slots' => [],
            ];
        }

        $data = json_decode($raw, true);
        if (!is_array($data)) {
            $errors[] = 'Manifest is not valid JSON: ' . $manifestPath;
            return [
                'ok' => false,
                'manifest' => $manifestPath,
                'keys_dir' => $keysDir,
                'errors' => $errors,
                'warnings' => $warnings,
                'slots' => [],
            ];
        }

        $slots = $data['slots'] ?? null;
        if (!is_array($slots) || $slots === []) {
            $errors[] = 'Manifest must contain a non-empty "slots" object.';
            $slots = [];
        }

        if (!is_dir($keysDir) || !is_readable($keysDir)) {
            $errors[] = 'Keys directory is not readable: ' . $keysDir;
        }
        $keysDirOk = is_dir($keysDir) && is_readable($keysDir);

        $manifestKeys = [];
        foreach ($slots as $slotName => $definition) {
            $slotErrors = [];
            $slotWarnings = [];
            $matchedFiles = [];
            $validKeys = [];
            $invalidFiles = [];

            if (!is_array($definition)) {
                $slotErrors[] = "Slot {$slotName} definition is not an object.";
                $slotsReport[(string)$slotName] = [
                    'slot' => (string)$slotName,
                    'key' => null,
                    'length' => null,
                    'matched_files' => [],
                    'valid_keys' => [],
                    'invalid_files' => [],
                ];
                $errors = array_merge($errors, $slotErrors);
                continue;
            }

            $keyName = $definition['key'] ?? null;
            $length = $definition['length'] ?? null;

            if (!is_string($keyName) || $keyName === '') {
                $slotErrors[] = "Slot {$slotName} is missing key name.";
                $keyName = null;
            } else {
                $manifestKeys[strtolower($keyName)] = true;
            }

            if (!is_int($length) || $length < 1) {
                $slotErrors[] = "Slot {$slotName} has invalid length.";
                $length = null;
            }

            if ($keyName !== null && $length !== null && $keysDirOk) {
                [$matchedFiles, $unversioned] = $this->findKeyFiles($keysDir, $keyName);
                foreach ($unversioned as $file) {
                    $slotWarnings[] = "Slot {$slotName}: unversioned key file will be ignored by resolver: {$file}";
                }

                if ($matchedFiles === []) {
                    $slotErrors[] = "Slot {$slotName}: no key files found for {$keyName} (expected {$keyName}_vN.{key|hex|b64})";
                } else {
                    foreach ($matchedFiles as $file) {
                        $base = basename($file);
                        if (!preg_match('~_v(?P<ver>\\d+)\\.(?P<ext>key|hex|b64)$~i', $base, $m)) {
                            $invalidFiles[] = ['file' => $file, 'reason' => 'invalid filename'];
                            continue;
                        }

                        $ver = (int)$m['ver'];
                        $ext = strtolower((string)$m['ext']);
                        $bytes = $this->loadKeyBytesFromFile($file, $ext, $length);
                        if (!is_string($bytes)) {
                            $invalidFiles[] = ['file' => $file, 'reason' => "invalid {$ext} or length mismatch (expected {$length} bytes)"];
                            continue;
                        }

                        $validKeys[] = [
                            'file' => $file,
                            'version' => $ver,
                            'ext' => $ext,
                            'bytes' => strlen($bytes),
                        ];
                    }

                    if ($validKeys === []) {
                        $slotErrors[] = "Slot {$slotName}: matching files exist but none are valid (decode/length).";
                    }
                }
            }

            $slotsReport[(string)$slotName] = [
                'slot' => (string)$slotName,
                'key' => $keyName,
                'length' => $length,
                'matched_files' => $matchedFiles,
                'valid_keys' => $validKeys,
                'invalid_files' => $invalidFiles,
            ];

            foreach ($slotErrors as $e) {
                $errors[] = $e;
            }
            foreach ($slotWarnings as $w) {
                $warnings[] = $w;
            }
        }

        $extraKeyFiles = [];
        if ($warnExtra && is_dir($keysDir)) {
            $extraKeyFiles = $this->findExtraVersionedKeyFiles($keysDir, array_keys($manifestKeys));
            foreach ($extraKeyFiles as $file) {
                $warnings[] = 'Extra key file (not referenced by manifest slots): ' . $file;
            }
        }

        return [
            'ok' => ($errors === []),
            'manifest' => $manifestPath,
            'keys_dir' => $keysDir,
            'errors' => $errors,
            'warnings' => $warnings,
            'slots' => $slotsReport,
            'extra_key_files' => $extraKeyFiles,
        ];
    }

    /** @param array<string,mixed> $report */
    private function printHuman(array $report): void
    {
        $ok = (bool)($report['ok'] ?? false);
        $manifest = (string)($report['manifest'] ?? '');
        $keysDir = (string)($report['keys_dir'] ?? '');

        echo ($ok ? "OK" : "FAIL") . ": keys lint\n";
        echo "  manifest: {$manifest}\n";
        echo "  keys_dir: {$keysDir}\n";

        $errors = $report['errors'] ?? [];
        $warnings = $report['warnings'] ?? [];

        if ($errors !== []) {
            echo "Errors:\n";
            foreach ($errors as $e) {
                echo "  - {$e}\n";
            }
        }
        if ($warnings !== []) {
            echo "Warnings:\n";
            foreach ($warnings as $w) {
                echo "  - {$w}\n";
            }
        }
    }

    /**
     * @return array{0:list<string>,1:list<string>} matched versioned files, unversioned matches
     */
    private function findKeyFiles(string $keysDir, string $keyName): array
    {
        $keyName = strtolower($keyName);
        $variants = array_values(array_unique([
            $keyName,
            str_replace(['.', '-'], '_', $keyName),
            str_replace(['.', '-', '_'], '', $keyName),
        ]));

        $allFiles = array_merge(
            glob(rtrim($keysDir, DIRECTORY_SEPARATOR) . '/*.' . self::EXT_KEY) ?: [],
            glob(rtrim($keysDir, DIRECTORY_SEPARATOR) . '/*.' . self::EXT_HEX) ?: [],
            glob(rtrim($keysDir, DIRECTORY_SEPARATOR) . '/*.' . self::EXT_B64) ?: [],
        );

        $matched = [];
        $unversioned = [];

        foreach ($allFiles as $file) {
            $base = basename($file);
            foreach ($variants as $variant) {
                if ($variant === '') {
                    continue;
                }

                $versionedPattern = '~^' . preg_quote($variant, '~') . '_v\\d+\\.(key|hex|b64)$~i';
                if (preg_match($versionedPattern, $base)) {
                    $matched[] = $file;
                    continue 2;
                }

                $unversionedPattern = '~^' . preg_quote($variant, '~') . '\\.(key|hex|b64)$~i';
                if (preg_match($unversionedPattern, $base)) {
                    $unversioned[] = $file;
                    continue 2;
                }
            }
        }

        sort($matched);
        sort($unversioned);
        return [$matched, $unversioned];
    }

    private function loadKeyBytesFromFile(string $file, string $ext, int $expectedLen): ?string
    {
        $raw = @file_get_contents($file);
        if ($raw === false) {
            return null;
        }

        if ($ext === self::EXT_KEY) {
            return (strlen($raw) === $expectedLen) ? $raw : null;
        }

        $txt = preg_replace('~\\s+~', '', trim($raw)) ?? '';
        if ($txt === '') {
            return null;
        }

        if ($ext === self::EXT_HEX) {
            if ((strlen($txt) % 2) !== 0 || !ctype_xdigit($txt)) {
                return null;
            }
            $bytes = @hex2bin($txt);
            return ($bytes !== false && strlen($bytes) === $expectedLen) ? $bytes : null;
        }

        if ($ext === self::EXT_B64) {
            $bytes = base64_decode($txt, true);
            return ($bytes !== false && strlen($bytes) === $expectedLen) ? $bytes : null;
        }

        return null;
    }

    /**
     * @param list<string> $manifestKeysLower
     * @return list<string>
     */
    private function findExtraVersionedKeyFiles(string $keysDir, array $manifestKeysLower): array
    {
        $manifestSet = [];
        foreach ($manifestKeysLower as $k) {
            $manifestSet[strtolower((string)$k)] = true;
        }

        $allFiles = array_merge(
            glob(rtrim($keysDir, DIRECTORY_SEPARATOR) . '/*.' . self::EXT_KEY) ?: [],
            glob(rtrim($keysDir, DIRECTORY_SEPARATOR) . '/*.' . self::EXT_HEX) ?: [],
            glob(rtrim($keysDir, DIRECTORY_SEPARATOR) . '/*.' . self::EXT_B64) ?: [],
        );

        $extra = [];
        foreach ($allFiles as $file) {
            $base = basename($file);
            if (!preg_match('~^(?P<name>[A-Za-z0-9_.-]+)_v\\d+\\.(key|hex|b64)$~', $base, $m)) {
                continue;
            }
            $name = strtolower((string)$m['name']);
            if (!isset($manifestSet[$name])) {
                $extra[] = $file;
            }
        }

        sort($extra);
        return $extra;
    }
}
