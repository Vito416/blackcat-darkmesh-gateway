<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Bridge\CoreCryptoBridge;
use RuntimeException;

final class VaultMigrateCommand implements CommandInterface
{
    public function name(): string
    {
        return 'vault:migrate';
    }

    public function description(): string
    {
        return 'Rewrap legacy FileVault binary into CryptoManager envelope.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$options, $positionals] = $this->parseArgs($args);
        $source = $positionals[0] ?? null;
        $dest = $positionals[1] ?? null;
        if (!$source || !$dest) {
            fwrite(STDERR, "Usage: vault:migrate [--context=core.vault] <source.enc> <dest.envelope>\n");
            return 1;
        }

        if (!is_file($source)) {
            fwrite(STDERR, "Source {$source} not found\n");
            return 1;
        }

        if (file_exists($dest) && empty($options['force'])) {
            fwrite(STDERR, "{$dest} already exists (use --force to overwrite)\n");
            return 1;
        }

        $context = (string)($options['context'] ?? 'core.vault');
        $payload = file_get_contents($source);
        if ($payload === false) {
            throw new RuntimeException('Cannot read encrypted file');
        }

        $parsed = $this->parseLegacyPayload($payload);
        $manager = CoreCryptoBridge::boot();
        $preferredKeyId = $parsed['keyId'] ?? null;
        $plaintext = $parsed['mode'] === 'single'
            ? $manager->decryptLocalWithAnyKey($context, $parsed['nonce'], $parsed['cipher'], $preferredKeyId)
            : $this->decryptSecretStream($parsed, CoreCryptoBridge::listKeyMaterial($context), $preferredKeyId);

        if ($plaintext === null) {
            throw new RuntimeException('Unable to decrypt legacy payload with available keys');
        }

        $envelope = $manager->encryptContext($context, $plaintext, ['wrapCount' => 0]);
        file_put_contents($dest, $envelope->encode());
        echo "Migrated {$source} -> {$dest}\n";
        return 0;
    }

    /**
     * @return array{mode:'single',nonce:string,cipher:string,keyId:?string}|array{mode:'stream',header:string,frames:string,keyId:?string}
     */
    private function parseLegacyPayload(string $data): array
    {
        $ptr = 0;
        $len = strlen($data);
        if ($len < 4) {
            throw new RuntimeException('Legacy payload too short');
        }

        $version = ord($data[$ptr++]);
        if (!in_array($version, [1, 2], true)) {
            throw new RuntimeException('Unsupported FileVault version ' . $version);
        }

        $keyId = null;
        if ($version === 2) {
            $keyLen = ord($data[$ptr++]);
            if ($keyLen > 0) {
                if ($ptr + $keyLen > $len) {
                    throw new RuntimeException('Key id exceeds payload length');
                }
                $keyId = substr($data, $ptr, $keyLen);
                $ptr += $keyLen;
            }
        }

        $nonceLen = ord($data[$ptr++]);
        if ($ptr + $nonceLen > $len) {
            throw new RuntimeException('Nonce exceeds payload length');
        }
        $nonce = substr($data, $ptr, $nonceLen);
        $ptr += $nonceLen;

        $tagLen = ord($data[$ptr++]);
        if ($ptr + $tagLen > $len) {
            throw new RuntimeException('Tag exceeds payload length');
        }

        if ($tagLen === 0) {
            $frames = substr($data, $ptr);
            return [
                'mode' => 'stream',
                'header' => $nonce,
                'frames' => $frames,
                'keyId' => $keyId,
            ];
        }

        $tag = substr($data, $ptr, $tagLen);
        $ptr += $tagLen;
        $cipher = substr($data, $ptr);

        return [
            'mode' => 'single',
            'nonce' => $nonce,
            'cipher' => $cipher . $tag,
            'keyId' => $keyId,
        ];
    }

    /**
     * @param array{mode:'stream',header:string,frames:string,keyId:?string} $parsed
     * @param list<array{id:string,bytes:string,slot:string}> $candidates
     */
    private function decryptSecretStream(array $parsed, array $candidates, ?string $preferredKeyId = null): ?string
    {
        if ($preferredKeyId !== null) {
            usort($candidates, static function ($a, $b) use ($preferredKeyId): int {
                $aPref = ($a['id'] === $preferredKeyId) ? 0 : 1;
                $bPref = ($b['id'] === $preferredKeyId) ? 0 : 1;
                return $aPref <=> $bPref;
            });
        }

        foreach ($candidates as $candidate) {
            $bytes = $candidate['bytes'];
            if ($bytes === '') {
                continue;
            }
            try {
                $state = sodium_crypto_secretstream_xchacha20poly1305_init_pull($parsed['header'], $bytes);
                $frames = $parsed['frames'];
                $ptr = 0;
                $len = strlen($frames);
                $plain = '';

                while ($ptr < $len) {
                    if ($ptr + 4 > $len) {
                        throw new RuntimeException('Truncated frame header');
                    }
                    $frameLen = unpack('Nlen', substr($frames, $ptr, 4))['len'] ?? 0;
                    $ptr += 4;
                    if ($frameLen <= 0 || $ptr + $frameLen > $len) {
                        throw new RuntimeException('Invalid frame length ' . $frameLen);
                    }
                    $frame = substr($frames, $ptr, $frameLen);
                    $ptr += $frameLen;
                    $result = sodium_crypto_secretstream_xchacha20poly1305_pull($state, $frame);
                    if ($result === false) {
                        throw new RuntimeException('Secretstream auth failed');
                    }
                    [$chunk, $tag] = $result;
                    $plain .= $chunk;
                    if ($tag === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL) {
                        return $plain;
                    }
                }
                throw new RuntimeException('Secretstream did not reach final tag');
            } catch (\Throwable $_) {
                continue;
            }
        }

        return null;
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
                if (str_contains($arg, '=')) {
                    [$name, $value] = explode('=', substr($arg, 2), 2);
                    $options[$name] = $value;
                } else {
                    $options[substr($arg, 2)] = '1';
                }
                continue;
            }
            $positionals[] = $arg;
        }
        return [$options, $positionals];
    }
}
