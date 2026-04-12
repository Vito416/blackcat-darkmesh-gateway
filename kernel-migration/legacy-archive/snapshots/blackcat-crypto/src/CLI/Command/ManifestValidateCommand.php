<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

final class ManifestValidateCommand implements CommandInterface
{
    public function name(): string
    {
        return 'manifest:validate';
    }

    public function description(): string
    {
        return 'Validate a manifest structure and report issues.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $json = false;
        $path = null;
        foreach ($args as $arg) {
            if ($arg === '--json') {
                $json = true;
                continue;
            }
            if (!str_starts_with($arg, '--')) {
                $path = $arg;
            }
        }

        if ($path === null) {
            fwrite(STDERR, "Usage: manifest:validate <manifest.json> [--json]\n");
            return 1;
        }

        [$valid, $issues] = $this->validateManifest($path);
        if ($json) {
            echo json_encode(['valid' => $valid, 'issues' => $issues], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        } else {
            if ($valid) {
                echo "Manifest OK: {$path}\n";
            } else {
                echo "Manifest issues ({$path}):\n";
                foreach ($issues as $issue) {
                    echo " - {$issue}\n";
                }
            }
        }

        return $valid ? 0 : 1;
    }

    /**
     * @return array{0:bool,1:array<int,string>}
     */
    private function validateManifest(string $path): array
    {
        if (!is_file($path)) {
            return [false, ["Manifest not found: {$path}"]];
        }
        $data = json_decode((string)file_get_contents($path), true);
        if (!is_array($data)) {
            return [false, ['Manifest is not valid JSON']];
        }
        $issues = [];
        if (array_key_exists('version', $data)) {
            if (!is_int($data['version']) || $data['version'] < 1) {
                $issues[] = 'version must be a positive integer when provided';
            }
        }

        $slots = $data['slots'] ?? null;
        if (!is_array($slots) || $slots === []) {
            $issues[] = 'slots must be a non-empty object/dictionary';
            $slots = [];
        }
        $allowedTypes = ['aes', 'aead', 'hmac', 'hybrid', 'wrap', 'rsa'];
        foreach ($slots as $slotName => $definition) {
            if (!is_string($slotName) || !preg_match('/^[a-z0-9._-]+$/', $slotName)) {
                $issues[] = "slot {$slotName} name must match /^[a-z0-9._-]+$/";
            }
            if (!is_array($definition)) {
                $issues[] = "slot {$slotName} is not an object";
                continue;
            }
            $type = $definition['type'] ?? null;
            if (!is_string($type) || $type === '') {
                $issues[] = "slot {$slotName} is missing type";
            } elseif (!in_array($type, $allowedTypes, true)) {
                $issues[] = "slot {$slotName} has unsupported type '{$type}'";
            }

            $key = $definition['key'] ?? null;
            if (!is_string($key) || $key === '') {
                $issues[] = "slot {$slotName} is missing key";
            } elseif (!preg_match('/^[A-Za-z0-9._-]+$/', $key)) {
                $issues[] = "slot {$slotName} key must match /^[A-Za-z0-9._-]+$/";
            }

            $length = $definition['length'] ?? null;
            if ($type !== null) {
                if (in_array($type, ['aes', 'aead', 'hmac'], true)) {
                    if (!is_int($length) || $length < 16 || $length > 256 || $length % 8 !== 0) {
                        $issues[] = "slot {$slotName} length must be 16-256 and divisible by 8 for type {$type}";
                    }
                } elseif (in_array($type, ['wrap', 'hybrid'], true)) {
                    if (!is_int($length) || $length < 24) {
                        $issues[] = "slot {$slotName} length must be >=24 for type {$type}";
                    }
                } elseif ($type === 'rsa' && (!is_int($length) || $length < 2048)) {
                    $issues[] = "slot {$slotName} length must be >=2048 for type rsa";
                }
            }

            if (isset($definition['options']) && !is_array($definition['options'])) {
                $issues[] = "slot {$slotName} options must be an object when provided";
            }
        }

        $rotation = $data['rotation'] ?? [];
        if (!is_array($rotation)) {
            $issues[] = 'rotation must be an object/dictionary';
            $rotation = [];
        }
        foreach ($rotation as $ctx => $rule) {
            if (!is_string($ctx) || $ctx === '' || !preg_match('/^[a-z0-9._*-]+$/', $ctx)) {
                $issues[] = "rotation rule key '{$ctx}' must match /^[a-z0-9._*-]+$/";
                continue;
            }
            if (!is_array($rule)) {
                $issues[] = "rotation rule {$ctx} must be an object";
                continue;
            }
            $hasAge = isset($rule['maxAgeSeconds']) && is_int($rule['maxAgeSeconds']) && $rule['maxAgeSeconds'] > 0;
            $hasWraps = isset($rule['maxWraps']) && is_int($rule['maxWraps']) && $rule['maxWraps'] > 0;
            if (!$hasAge && !$hasWraps) {
                $issues[] = "rotation rule {$ctx} should define positive maxAgeSeconds or maxWraps";
            }

            if (!str_contains($ctx, '*') && !array_key_exists($ctx, $slots)) {
                $issues[] = "rotation rule {$ctx} refers to unknown slot";
            }
        }

        return [count($issues) === 0, $issues];
    }
}
