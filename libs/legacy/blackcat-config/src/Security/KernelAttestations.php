<?php

declare(strict_types=1);

namespace BlackCat\Config\Security;

final class KernelAttestations
{
    private const RUNTIME_CONFIG_ATTESTATION_KEY_LABEL_V1 = 'blackcat.runtime_config.canonical_sha256.v1';
    private const COMPOSER_LOCK_ATTESTATION_KEY_LABEL_V1 = 'blackcat.composer.lock.canonical_sha256.v1';
    private const PHP_FINGERPRINT_ATTESTATION_KEY_LABEL_V1 = 'blackcat.php.fingerprint.canonical_sha256.v1';
    private const PHP_FINGERPRINT_ATTESTATION_KEY_LABEL_V2 = 'blackcat.php.fingerprint.canonical_sha256.v2';
    private const IMAGE_DIGEST_ATTESTATION_KEY_LABEL_V1 = 'blackcat.image.digest.sha256.v1';
    private const HTTP_ALLOWED_HOSTS_ATTESTATION_KEY_LABEL_V1 = 'blackcat.http.allowed_hosts.canonical_sha256.v1';
    private const CGI_FIX_PATHINFO_PROBE_ATTESTATION_KEY_LABEL_V1 = 'blackcat.hosting.cgi_fix_pathinfo.probe.canonical_sha256.v1';

    public static function runtimeConfigAttestationKeyV1(): string
    {
        return '0x' . hash('sha256', self::RUNTIME_CONFIG_ATTESTATION_KEY_LABEL_V1);
    }

    /**
     * @param array<string,mixed> $runtimeConfig
     */
    public static function runtimeConfigAttestationValueV1(array $runtimeConfig): string
    {
        return CanonicalJson::sha256Bytes32($runtimeConfig);
    }

    public static function composerLockAttestationKeyV1(): string
    {
        return '0x' . hash('sha256', self::COMPOSER_LOCK_ATTESTATION_KEY_LABEL_V1);
    }

    /**
     * @param array<string,mixed> $composerLock
     */
    public static function composerLockAttestationValueV1(array $composerLock): string
    {
        return CanonicalJson::sha256Bytes32($composerLock);
    }

    public static function phpFingerprintAttestationKeyV1(): string
    {
        return '0x' . hash('sha256', self::PHP_FINGERPRINT_ATTESTATION_KEY_LABEL_V1);
    }

    /**
     * @return array{schema_version:int,type:string,php_version:string,php_sapi:string,extensions:array<string,string|null>}
     */
    public static function phpFingerprintPayloadV1(): array
    {
        $extensions = get_loaded_extensions();
        sort($extensions, SORT_STRING);

        $map = [];
        foreach ($extensions as $ext) {
            if (!is_string($ext) || $ext === '') {
                continue;
            }
            $version = phpversion($ext);
            $map[$ext] = is_string($version) && trim($version) !== '' ? trim($version) : null;
        }

        return [
            'schema_version' => 1,
            'type' => 'blackcat.php.fingerprint',
            'php_version' => PHP_VERSION,
            'php_sapi' => PHP_SAPI,
            'extensions' => $map,
        ];
    }

    /**
     * @param array{schema_version:int,type:string,php_version:string,php_sapi:string,extensions:array<string,string|null>} $payload
     */
    public static function phpFingerprintAttestationValueV1(array $payload): string
    {
        return CanonicalJson::sha256Bytes32($payload);
    }

    public static function phpFingerprintAttestationKeyV2(): string
    {
        return '0x' . hash('sha256', self::PHP_FINGERPRINT_ATTESTATION_KEY_LABEL_V2);
    }

    /**
     * Stable PHP fingerprint intended for multi-process deployments (web SAPI + CLI workers).
     *
     * Notes:
     * - Excludes PHP_SAPI to avoid false mismatches between PHP-FPM/CLI/cli-server workers.
     *
     * @return array{schema_version:int,type:string,php_version:string,extensions:array<string,string|null>}
     */
    public static function phpFingerprintPayloadV2(): array
    {
        $extensions = get_loaded_extensions();
        sort($extensions, SORT_STRING);

        $map = [];
        foreach ($extensions as $ext) {
            if (!is_string($ext) || $ext === '') {
                continue;
            }
            $version = phpversion($ext);
            $map[$ext] = is_string($version) && trim($version) !== '' ? trim($version) : null;
        }

        return [
            'schema_version' => 2,
            'type' => 'blackcat.php.fingerprint',
            'php_version' => PHP_VERSION,
            'extensions' => $map,
        ];
    }

    /**
     * @param array{schema_version:int,type:string,php_version:string,extensions:array<string,string|null>} $payload
     */
    public static function phpFingerprintAttestationValueV2(array $payload): string
    {
        return CanonicalJson::sha256Bytes32($payload);
    }

    public static function imageDigestAttestationKeyV1(): string
    {
        return '0x' . hash('sha256', self::IMAGE_DIGEST_ATTESTATION_KEY_LABEL_V1);
    }

    public static function httpAllowedHostsAttestationKeyV1(): string
    {
        return '0x' . hash('sha256', self::HTTP_ALLOWED_HOSTS_ATTESTATION_KEY_LABEL_V1);
    }

    /**
     * @param array<mixed> $allowedHostsRaw
     * @return array{schema_version:int,type:string,hosts:list<string>}
     */
    public static function httpAllowedHostsPayloadV1(array $allowedHostsRaw): array
    {
        $normalized = self::normalizeAllowedHostsListOrThrow($allowedHostsRaw);

        return [
            'schema_version' => 1,
            'type' => 'blackcat.http.allowed_hosts',
            'hosts' => $normalized,
        ];
    }

    /**
     * @param array<mixed> $allowedHostsRaw
     */
    public static function httpAllowedHostsAttestationValueV1(array $allowedHostsRaw): string
    {
        return CanonicalJson::sha256Bytes32(self::httpAllowedHostsPayloadV1($allowedHostsRaw));
    }

    public static function cgiFixPathInfoProbeAttestationKeyV1(): string
    {
        return '0x' . hash('sha256', self::CGI_FIX_PATHINFO_PROBE_ATTESTATION_KEY_LABEL_V1);
    }

    /**
     * Canonical payload representing a "NO EXEC" result for the CGI PathInfo probe.
     *
     * @return array{schema_version:int,type:string,result:string}
     */
    public static function cgiFixPathInfoProbeNoExecPayloadV1(): array
    {
        return [
            'schema_version' => 1,
            'type' => 'blackcat.hosting.cgi_fix_pathinfo.probe',
            'result' => 'no_exec',
        ];
    }

    /**
     * @param array{schema_version:int,type:string,result:string} $payload
     */
    public static function cgiFixPathInfoProbeAttestationValueV1(array $payload): string
    {
        return CanonicalJson::sha256Bytes32($payload);
    }

    public static function cgiFixPathInfoProbeNoExecAttestationValueV1(): string
    {
        return self::cgiFixPathInfoProbeAttestationValueV1(self::cgiFixPathInfoProbeNoExecPayloadV1());
    }

    /**
     * Canonical value is the raw 32-byte sha256 digest (as bytes32 hex).
     *
     * Accepts:
     * - "sha256:<64-hex>"
     * - "0x<64-hex>"
     * - "<64-hex>"
     */
    public static function imageDigestAttestationValueV1(string $digest): string
    {
        $digest = trim($digest);
        if ($digest === '' || str_contains($digest, "\0")) {
            throw new \InvalidArgumentException('Invalid image digest string.');
        }

        if (str_starts_with($digest, 'sha256:')) {
            $digest = substr($digest, 7);
        }

        if (str_starts_with($digest, '0x') || str_starts_with($digest, '0X')) {
            $digest = substr($digest, 2);
        }

        $digest = trim($digest);
        if (!preg_match('/^[a-fA-F0-9]{64}$/', $digest)) {
            throw new \InvalidArgumentException('Image digest must be 32 bytes of hex (sha256).');
        }

        return '0x' . strtolower($digest);
    }

    /**
     * @param array<mixed> $raw
     * @return list<string>
     */
    private static function normalizeAllowedHostsListOrThrow(array $raw): array
    {
        if ($raw === []) {
            throw new \InvalidArgumentException('http.allowed_hosts must be a non-empty list.');
        }

        $out = [];
        foreach ($raw as $i => $v) {
            if (!is_string($v)) {
                throw new \InvalidArgumentException('http.allowed_hosts[' . $i . '] must be a string.');
            }
            $v = trim($v);
            if ($v === '') {
                throw new \InvalidArgumentException('http.allowed_hosts[' . $i . '] must be non-empty.');
            }
            if (str_contains($v, "\0") || str_contains($v, "\r") || str_contains($v, "\n")) {
                throw new \InvalidArgumentException('http.allowed_hosts[' . $i . '] contains invalid characters.');
            }
            if (str_contains($v, '://') || str_contains($v, '/') || str_contains($v, '\\')) {
                throw new \InvalidArgumentException('http.allowed_hosts[' . $i . '] must be a host or host:port (not a URL).');
            }

            if (str_starts_with($v, '*.')) {
                $suffix = strtolower(trim(substr($v, 2)));
                if ($suffix === '') {
                    throw new \InvalidArgumentException('http.allowed_hosts[' . $i . '] wildcard suffix is empty.');
                }
                if (str_contains($suffix, "\0")) {
                    throw new \InvalidArgumentException('http.allowed_hosts[' . $i . '] wildcard suffix contains invalid characters.');
                }
                if (!preg_match('/^[a-z0-9.-]+$/', $suffix)) {
                    throw new \InvalidArgumentException('http.allowed_hosts[' . $i . '] wildcard suffix has invalid characters.');
                }
                if (str_contains($suffix, '..') || str_starts_with($suffix, '.') || str_ends_with($suffix, '.')) {
                    throw new \InvalidArgumentException('http.allowed_hosts[' . $i . '] wildcard suffix is not a valid hostname.');
                }

                $out['*.' . $suffix] = true;
                continue;
            }

            $host = self::normalizeHostLikeOrThrow($v, 'http.allowed_hosts[' . $i . ']');
            $out[$host] = true;
        }

        $list = array_keys($out);
        sort($list, SORT_STRING);
        return $list;
    }

    private static function normalizeHostLikeOrThrow(string $value, string $label): string
    {
        $value = trim($value);
        if ($value === '' || str_contains($value, "\0")) {
            throw new \InvalidArgumentException($label . ' is invalid.');
        }

        if (str_contains($value, '://') || str_contains($value, '/') || str_contains($value, '\\')) {
            throw new \InvalidArgumentException($label . ' must be a host or host:port (not a URL).');
        }

        // Bracketed IPv6: [::1] or [::1]:443
        if (str_starts_with($value, '[')) {
            $end = strpos($value, ']');
            if ($end === false) {
                throw new \InvalidArgumentException($label . ' has invalid bracketed IPv6 form.');
            }
            $ipv6 = substr($value, 1, $end - 1);
            if ($ipv6 === '' || @filter_var($ipv6, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
                throw new \InvalidArgumentException($label . ' has invalid IPv6 address.');
            }

            $rest = trim(substr($value, $end + 1));
            if ($rest !== '') {
                if (!str_starts_with($rest, ':')) {
                    throw new \InvalidArgumentException($label . ' has invalid bracketed IPv6 form.');
                }
                $port = trim(substr($rest, 1));
                if ($port === '' || !ctype_digit($port)) {
                    throw new \InvalidArgumentException($label . ' has invalid port.');
                }
                $portNum = (int) $port;
                if ($portNum < 1 || $portNum > 65535) {
                    throw new \InvalidArgumentException($label . ' has invalid port.');
                }
            }

            return strtolower($ipv6);
        }

        $host = $value;
        if (str_contains($value, ':')) {
            [$h, $p] = explode(':', $value, 2) + [null, null];
            if (!is_string($h) || !is_string($p)) {
                throw new \InvalidArgumentException($label . ' has invalid host:port form.');
            }
            $host = $h;

            $p = trim($p);
            if ($p === '' || !ctype_digit($p)) {
                throw new \InvalidArgumentException($label . ' has invalid port.');
            }
            $portNum = (int) $p;
            if ($portNum < 1 || $portNum > 65535) {
                throw new \InvalidArgumentException($label . ' has invalid port.');
            }
        }

        $host = strtolower(trim($host));
        if ($host === '' || str_contains($host, "\0")) {
            throw new \InvalidArgumentException($label . ' host is invalid.');
        }

        if (@filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_IPV6) !== false) {
            return $host;
        }

        if (!preg_match('/^[a-z0-9.-]+$/', $host)) {
            throw new \InvalidArgumentException($label . ' host has invalid characters.');
        }
        if (str_contains($host, '..') || str_starts_with($host, '.') || str_ends_with($host, '.')) {
            throw new \InvalidArgumentException($label . ' host is not a valid hostname.');
        }

        return $host;
    }
}
