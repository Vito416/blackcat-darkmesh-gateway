<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Bridge\CoreCryptoBridge;

final class VaultDecryptCommand implements CommandInterface
{
    public function name(): string
    {
        return 'vault:decrypt';
    }

    public function description(): string
    {
        return 'Decrypt a FileVault .enc payload and print/write the plaintext.';
    }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        [$options, $positionals] = $this->parseArgs($args);
        $path = $positionals[0] ?? null;
        if ($path === null) {
            fwrite(STDERR, "Usage: vault:decrypt [--context=core.vault] [--output=path] <file.enc>\n");
            return 1;
        }

        if (!is_file($path)) {
            fwrite(STDERR, "File {$path} not found\n");
            return 1;
        }

        $payload = file_get_contents($path);
        if ($payload === false) {
            fwrite(STDERR, "Unable to read {$path}\n");
            return 1;
        }

        $parsed = $this->parsePayload($payload);
        $context = (string)($options['context'] ?? 'core.vault');

        $manager = CoreCryptoBridge::boot();
        $preferredKeyId = $parsed['keyId'] ?? null;
        $plaintext = $parsed['mode'] === 'single'
            ? $manager->decryptLocalWithAnyKey($context, $parsed['nonce'], $parsed['cipher'], $preferredKeyId)
            : $this->decryptStream($parsed, CoreCryptoBridge::listKeyMaterial($context), $preferredKeyId);

        if ($plaintext === null) {
            fwrite(STDERR, "Failed to decrypt {$path} using context {$context}\n");
            return 2;
        }

        if (!empty($options['output'])) {
            file_put_contents($options['output'], $plaintext);
            echo "Decrypted payload written to {$options['output']}\n";
        } else {
            echo $plaintext;
        }

        return 0;
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
     * @return array{mode:'single',nonce:string,cipher:string,keyId?:string}|array{mode:'stream',header:string,frames:string,keyId?:string}
     */
    private function parsePayload(string $data): array
    {
        $ptr = 0;
        $len = strlen($data);
        $version = ord($data[$ptr++]);
        if (!in_array($version, [1, 2], true)) {
            throw new \RuntimeException('Unsupported payload version: ' . $version);
        }

        $keyId = null;
        if ($version === 2) {
            $keyLen = ord($data[$ptr++]);
            if ($keyLen > 0) {
                $keyId = substr($data, $ptr, $keyLen);
                $ptr += $keyLen;
            }
        }

        $nonceLen = ord($data[$ptr++]);
        $nonce = substr($data, $ptr, $nonceLen);
        $ptr += $nonceLen;

        $tagLen = ord($data[$ptr++]);
        if ($tagLen === 0) {
            $frames = substr($data, $ptr);
            return ['mode' => 'stream', 'header' => $nonce, 'frames' => $frames] + ($keyId ? ['keyId' => $keyId] : []);
        }

        $tag = substr($data, $ptr, $tagLen);
        $ptr += $tagLen;
        $cipher = substr($data, $ptr);
        $out = ['mode' => 'single', 'nonce' => $nonce, 'cipher' => $cipher . $tag];
        if ($keyId) {
            $out['keyId'] = $keyId;
        }
        return $out;
    }

    /**
     * @param array{mode:'stream',header:string,frames:string,keyId?:string} $parsed
     * @param list<array{id:string,bytes:string,slot:string}> $candidates
     */
    private function decryptStream(array $parsed, array $candidates, ?string $preferredKeyId = null): ?string
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
                        throw new \RuntimeException('truncated frame header');
                    }
                    $frameLen = unpack('Nlen', substr($frames, $ptr, 4))['len'] ?? 0;
                    $ptr += 4;
                    if ($frameLen <= 0 || $ptr + $frameLen > $len) {
                        throw new \RuntimeException('invalid frame length');
                    }
                    $frame = substr($frames, $ptr, $frameLen);
                    $ptr += $frameLen;
                    $result = sodium_crypto_secretstream_xchacha20poly1305_pull($state, $frame);
                    if ($result === false) {
                        throw new \RuntimeException('secretstream auth failed');
                    }
                    [$chunk, $tag] = $result;
                    $plain .= $chunk;
                    if ($tag === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL) {
                        return $plain;
                    }
                }
            } catch (\Throwable $e) {
                continue;
            }
        }

        return null;
    }
}
