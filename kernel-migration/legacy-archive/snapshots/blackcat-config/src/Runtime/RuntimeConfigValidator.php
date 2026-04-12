<?php

declare(strict_types=1);

namespace BlackCat\Config\Runtime;

use BlackCat\Config\Security\ConfigDirPolicy;
use BlackCat\Config\Security\ConfigFilePolicy;
use BlackCat\Config\Security\KernelAttestations;
use BlackCat\Config\Security\SecureDir;
use BlackCat\Config\Security\SecureFile;

final class RuntimeConfigValidator
{
    /**
     * Validate HTTP/runtime edge configuration.
     *
     * Optional:
     * - http.trusted_proxies (list of IP/CIDR strings)
     * - http.allowed_hosts (non-empty list of host patterns: host, host:port, *.domain.tld, [ipv6]:port)
     */
    public static function assertHttpConfig(ConfigRepository $repo): void
    {
        $http = $repo->get('http');
        if ($http === null) {
            return;
        }
        if (!is_array($http)) {
            throw new \RuntimeException('Invalid config type for http (expected object).');
        }

        $trustedProxies = $repo->get('http.trusted_proxies');
        if ($trustedProxies !== null && $trustedProxies !== '') {
            if (!is_array($trustedProxies)) {
                throw new \RuntimeException('Invalid config type for http.trusted_proxies (expected list of strings).');
            }

            foreach ($trustedProxies as $i => $peer) {
                if (!is_string($peer)) {
                    throw new \RuntimeException('Invalid config type for http.trusted_proxies[' . $i . '] (expected string).');
                }
                $peer = trim($peer);
                if ($peer === '') {
                    throw new \RuntimeException('Invalid config value for http.trusted_proxies[' . $i . '] (expected non-empty string).');
                }
                if (str_contains($peer, "\0")) {
                    throw new \RuntimeException('Invalid config value for http.trusted_proxies[' . $i . '] (contains null byte).');
                }
                if (!self::isValidIpOrCidr($peer)) {
                    throw new \RuntimeException('Invalid config value for http.trusted_proxies[' . $i . '] (expected IP or CIDR).');
                }
            }
        }

        $allowedHosts = $repo->get('http.allowed_hosts');
        if ($allowedHosts !== null && $allowedHosts !== '') {
            if (!is_array($allowedHosts)) {
                throw new \RuntimeException('Invalid config type for http.allowed_hosts (expected list of strings).');
            }

            // Ensures the same normalization as the on-chain attestation value.
            try {
                KernelAttestations::httpAllowedHostsPayloadV1($allowedHosts);
            } catch (\InvalidArgumentException $e) {
                throw new \RuntimeException('Invalid config value for http.allowed_hosts: ' . $e->getMessage(), 0, $e);
            }
        }
    }

    /**
     * Validate security-critical crypto config.
     *
     * Required:
     * - crypto.keys_dir (secure directory)
     *
     * Optional:
     * - crypto.manifest (public-readable file is allowed, but must not be writable/symlink)
     */
    public static function assertCryptoConfig(ConfigRepository $repo): void
    {
        $agentSocket = $repo->get('crypto.agent.socket_path');
        if ($agentSocket !== null && $agentSocket !== '') {
            if (!is_string($agentSocket)) {
                throw new \RuntimeException('Invalid config type for crypto.agent.socket_path (expected string).');
            }
            $resolvedSocket = $repo->resolvePath($agentSocket);
            self::assertAbsolutePath($resolvedSocket, 'crypto.agent.socket_path');
        }

        $keysDirRaw = $repo->get('crypto.keys_dir');
        if ($keysDirRaw === null || $keysDirRaw === '') {
            throw new \RuntimeException('Missing required config string: crypto.keys_dir');
        }

        if (!is_string($keysDirRaw)) {
            throw new \RuntimeException('Invalid config type for crypto.keys_dir (expected string).');
        }

        $keysDir = $repo->resolvePath($keysDirRaw);
        self::assertAbsolutePath($keysDir, 'crypto.keys_dir');

        if ($agentSocket === null || $agentSocket === '') {
            SecureDir::assertSecureReadableDir($keysDir, ConfigDirPolicy::secretsDir());
        } else {
            // Best-effort validation only (do not require runtime readability).
            if (str_contains($keysDir, "\0") || trim($keysDir) === '') {
                throw new \RuntimeException('Invalid config value for crypto.keys_dir.');
            }
        }

        $manifest = $repo->get('crypto.manifest');
        if ($manifest === null || $manifest === '') {
            return;
        }
        if (!is_string($manifest)) {
            throw new \RuntimeException('Invalid config type for crypto.manifest (expected string).');
        }

        SecureFile::assertSecureReadableFile($repo->resolvePath($manifest), ConfigFilePolicy::publicReadable());
    }

    /**
     * Validate DB config (TrustKernel deployments should keep credentials out of runtime config).
     *
     * Optional:
     * - db.agent.socket_path (absolute path)
     * - db.credentials_file (absolute path, used by the secrets-agent; not readable by web runtime)
     *
     * In TrustKernel deployments (when trust.web3 exists):
     * - db.agent.socket_path is required
     * - db.dsn/db.user/db.pass must NOT be present in runtime config (attack surface)
     */
    public static function assertDbConfig(ConfigRepository $repo): void
    {
        $db = $repo->get('db');
        if ($db === null) {
            return;
        }
        if (!is_array($db)) {
            throw new \RuntimeException('Invalid config type for db (expected object).');
        }

        $trustWeb3 = $repo->get('trust.web3');

        $agentSocket = $repo->get('db.agent.socket_path');
        if ($agentSocket !== null && $agentSocket !== '') {
            if (!is_string($agentSocket)) {
                throw new \RuntimeException('Invalid config type for db.agent.socket_path (expected string).');
            }
            $resolved = $repo->resolvePath($agentSocket);
            self::assertAbsolutePath($resolved, 'db.agent.socket_path');
        }

        $credsFile = $repo->get('db.credentials_file');
        if ($credsFile !== null && $credsFile !== '') {
            if (!is_string($credsFile)) {
                throw new \RuntimeException('Invalid config type for db.credentials_file (expected string).');
            }
            $resolved = $repo->resolvePath($credsFile);
            self::assertAbsolutePath($resolved, 'db.credentials_file');
        }

        if ($trustWeb3 !== null) {
            if ($agentSocket === null || $agentSocket === '') {
                throw new \RuntimeException('Missing required config string: db.agent.socket_path');
            }

            $inline = [
                'db.dsn',
                'db.user',
                'db.pass',
            ];
            foreach ($inline as $k) {
                $v = $repo->get($k);
                if ($v !== null && $v !== '') {
                    throw new \RuntimeException('Inline DB credentials are not allowed in TrustKernel runtime config: ' . $k);
                }
            }
        }
    }

    /**
     * Validate observability local-store config.
     *
     * Required:
     * - observability.storage_dir (secure directory)
     *
     * Optional:
     * - observability.service (non-empty string)
     */
    public static function assertObservabilityConfig(ConfigRepository $repo): void
    {
        $storageDir = $repo->resolvePath($repo->requireString('observability.storage_dir'));
        SecureDir::assertSecureReadableDir($storageDir, ConfigDirPolicy::secretsDir());

        $service = $repo->get('observability.service');
        if ($service === null || $service === '') {
            return;
        }
        if (!is_string($service)) {
            throw new \RuntimeException('Invalid config type for observability.service (expected string).');
        }
        if (trim($service) === '') {
            throw new \RuntimeException('Invalid config value for observability.service (expected non-empty string).');
        }
    }

    /**
     * Validate Web3 trust-kernel configuration (EVM JSON-RPC).
     *
     * This config is optional until the trust-kernel runtime is fully adopted across the ecosystem.
     * If `trust.web3` is missing, this validator is a no-op.
     *
     * Required (when trust.web3 exists):
     * - trust.web3.chain_id (int)
     * - trust.web3.rpc_endpoints (non-empty list of HTTPS endpoints; HTTP allowed only for localhost)
     * - trust.web3.rpc_quorum (int; 1..count(rpc_endpoints))
     * - trust.web3.contracts.instance_controller (EVM address)
     * - trust.integrity.root_dir (absolute or relative to config; readable dir, not writable)
     * - trust.integrity.manifest (absolute or relative to config; readable file, not writable)
     *
     * Optional:
     * - trust.web3.contracts.release_registry (EVM address)
     * - trust.web3.max_stale_sec (int; default 180)
     * - trust.web3.mode ("root_uri" | "full"; default "full")
     * - trust.web3.tx_outbox_dir (secure readable dir; recommended when buffering transactions)
     * - trust.web3.timeout_sec (int; default 5)
     * - trust.enforcement ("strict" | "warn"; default "strict") (deprecated; enforcement is bound to on-chain policy hash)
     */
    public static function assertTrustKernelWeb3Config(ConfigRepository $repo): void
    {
        $web3 = $repo->get('trust.web3');
        if ($web3 === null) {
            return;
        }
        if (!is_array($web3)) {
            throw new \RuntimeException('Invalid config type for trust.web3 (expected object).');
        }

        $chainId = $repo->requireInt('trust.web3.chain_id');
        if ($chainId <= 0) {
            throw new \RuntimeException('Invalid config value for trust.web3.chain_id (expected > 0).');
        }

        $endpoints = $repo->get('trust.web3.rpc_endpoints');
        if (!is_array($endpoints) || $endpoints === []) {
            throw new \RuntimeException('Missing required config list: trust.web3.rpc_endpoints');
        }

        $normalizedEndpoints = [];
        foreach ($endpoints as $i => $endpoint) {
            if (!is_string($endpoint)) {
                throw new \RuntimeException('Invalid config type for trust.web3.rpc_endpoints[' . $i . '] (expected string).');
            }
            $endpoint = trim($endpoint);
            if ($endpoint === '') {
                throw new \RuntimeException('Invalid config value for trust.web3.rpc_endpoints[' . $i . '] (expected non-empty string).');
            }
            if (str_contains($endpoint, "\0")) {
                throw new \RuntimeException('Invalid config value for trust.web3.rpc_endpoints[' . $i . '] (contains null byte).');
            }
            if (!self::isAllowedRpcEndpoint($endpoint)) {
                throw new \RuntimeException(
                    'Invalid config value for trust.web3.rpc_endpoints[' . $i . ']: endpoint must be https:// (http:// allowed only for localhost).'
                );
            }

            $normalizedEndpoints[] = $endpoint;
        }

        $quorumRaw = $repo->get('trust.web3.rpc_quorum', 1);
        $quorum = self::parseIntLike($quorumRaw, 'trust.web3.rpc_quorum');
        $max = count($normalizedEndpoints);
        if ($quorum < 1 || $quorum > $max) {
            throw new \RuntimeException('Invalid config value for trust.web3.rpc_quorum (expected 1..' . $max . ').');
        }

        $maxStaleRaw = $repo->get('trust.web3.max_stale_sec', 180);
        $maxStaleSec = self::parseIntLike($maxStaleRaw, 'trust.web3.max_stale_sec');
        if ($maxStaleSec < 1 || $maxStaleSec > 86400) {
            throw new \RuntimeException('Invalid config value for trust.web3.max_stale_sec (expected 1..86400).');
        }

        $modeRaw = $repo->get('trust.web3.mode', 'full');
        if (!is_string($modeRaw)) {
            throw new \RuntimeException('Invalid config type for trust.web3.mode (expected string).');
        }
        $mode = strtolower(trim($modeRaw));
        if ($mode === '' || !in_array($mode, ['root_uri', 'full'], true)) {
            throw new \RuntimeException('Invalid config value for trust.web3.mode (expected "root_uri" or "full").');
        }

        $controller = $repo->requireString('trust.web3.contracts.instance_controller');
        self::assertEvmAddress($controller, 'trust.web3.contracts.instance_controller');

        $releaseRegistry = $repo->get('trust.web3.contracts.release_registry');
        if ($releaseRegistry !== null && $releaseRegistry !== '') {
            if (!is_string($releaseRegistry)) {
                throw new \RuntimeException('Invalid config type for trust.web3.contracts.release_registry (expected string).');
            }
            // Allow `0x000...0` explicitly to support installs that disable the ReleaseRegistry pointer on-chain
            // (InstanceController.releaseRegistry == 0). This is still protected by the runtime-config attestation,
            // so tampering the value in production remains detectable and fail-closed.
            self::assertEvmAddressAllowZero($releaseRegistry, 'trust.web3.contracts.release_registry');
        }

        $factory = $repo->get('trust.web3.contracts.instance_factory');
        if ($factory !== null && $factory !== '') {
            if (!is_string($factory)) {
                throw new \RuntimeException('Invalid config type for trust.web3.contracts.instance_factory (expected string).');
            }
            self::assertEvmAddress($factory, 'trust.web3.contracts.instance_factory');
        }

        $timeoutRaw = $repo->get('trust.web3.timeout_sec', 5);
        $timeoutSec = self::parseIntLike($timeoutRaw, 'trust.web3.timeout_sec');
        if ($timeoutSec < 1 || $timeoutSec > 60) {
            throw new \RuntimeException('Invalid config value for trust.web3.timeout_sec (expected 1..60).');
        }

        $txOutboxDir = $repo->get('trust.web3.tx_outbox_dir');
        if ($txOutboxDir !== null && $txOutboxDir !== '') {
            if (!is_string($txOutboxDir)) {
                throw new \RuntimeException('Invalid config type for trust.web3.tx_outbox_dir (expected string).');
            }
            $resolvedOutboxDir = $repo->resolvePath($txOutboxDir);
            SecureDir::assertSecureReadableDir($resolvedOutboxDir, ConfigDirPolicy::txOutboxDir());
            if (!is_writable($resolvedOutboxDir)) {
                throw new \RuntimeException('Config directory is not writable: trust.web3.tx_outbox_dir');
            }
        }

        $integrityRootDir = $repo->resolvePath($repo->requireString('trust.integrity.root_dir'));
        self::assertAbsolutePath($integrityRootDir, 'trust.integrity.root_dir');
        SecureDir::assertSecureReadableDir($integrityRootDir, ConfigDirPolicy::integrityRootDir());

        $manifestPath = $repo->resolvePath($repo->requireString('trust.integrity.manifest'));
        self::assertAbsolutePath($manifestPath, 'trust.integrity.manifest');
        SecureFile::assertSecureReadableFile($manifestPath, ConfigFilePolicy::integrityManifest());

        $enforcementRaw = $repo->get('trust.enforcement', 'strict');
        if (!is_string($enforcementRaw)) {
            throw new \RuntimeException('Invalid config type for trust.enforcement (expected string).');
        }
        $enforcement = strtolower(trim($enforcementRaw));
        if ($enforcement === '' || !in_array($enforcement, ['strict', 'warn'], true)) {
            throw new \RuntimeException('Invalid config value for trust.enforcement (expected "strict" or "warn").');
        }
    }

    private static function parseIntLike(mixed $value, string $key): int
    {
        if (is_int($value)) {
            return $value;
        }
        if (is_string($value)) {
            $trimmed = trim($value);
            if ($trimmed !== '' && ctype_digit($trimmed)) {
                return (int) $trimmed;
            }
        }

        throw new \RuntimeException('Invalid config type/value for ' . $key . ' (expected integer).');
    }

    private static function isAllowedRpcEndpoint(string $endpoint): bool
    {
        $endpoint = trim($endpoint);
        if ($endpoint === '') {
            return false;
        }

        $parts = @parse_url($endpoint);
        if (!is_array($parts)) {
            return false;
        }

        $scheme = $parts['scheme'] ?? null;
        if (!is_string($scheme) || $scheme === '') {
            return false;
        }
        $scheme = strtolower($scheme);

        if ($scheme === 'https') {
            return true;
        }

        if ($scheme !== 'http') {
            return false;
        }

        $host = $parts['host'] ?? null;
        if (!is_string($host) || $host === '') {
            return false;
        }
        $host = strtolower($host);

        return $host === 'localhost' || $host === '127.0.0.1' || $host === '::1';
    }

    private static function isValidIpOrCidr(string $peer): bool
    {
        $peer = trim($peer);
        if ($peer === '' || str_contains($peer, "\0")) {
            return false;
        }

        if (!str_contains($peer, '/')) {
            return filter_var($peer, FILTER_VALIDATE_IP) !== false;
        }

        [$ip, $bitsRaw] = explode('/', $peer, 2) + [null, null];
        if (!is_string($ip) || !is_string($bitsRaw)) {
            return false;
        }
        $ip = trim($ip);
        $bitsRaw = trim($bitsRaw);
        if ($ip === '' || $bitsRaw === '' || !ctype_digit($bitsRaw)) {
            return false;
        }

        $bits = (int) $bitsRaw;
        $isV4 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
        $isV6 = filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false;
        if (!$isV4 && !$isV6) {
            return false;
        }

        if ($isV4 && ($bits < 0 || $bits > 32)) {
            return false;
        }
        if ($isV6 && ($bits < 0 || $bits > 128)) {
            return false;
        }

        return true;
    }

    private static function assertEvmAddress(string $address, string $key): void
    {
        $address = trim($address);
        if ($address === '') {
            throw new \RuntimeException('Missing required config string: ' . $key);
        }

        if (!preg_match('/^0x[a-fA-F0-9]{40}$/', $address)) {
            throw new \RuntimeException('Invalid EVM address for ' . $key . '.');
        }

        if (strtolower($address) === '0x0000000000000000000000000000000000000000') {
            throw new \RuntimeException('Invalid EVM address for ' . $key . ' (zero address).');
        }
    }

    private static function assertEvmAddressAllowZero(string $address, string $key): void
    {
        $address = trim($address);
        if ($address === '') {
            throw new \RuntimeException('Missing required config string: ' . $key);
        }

        if (!preg_match('/^0x[a-fA-F0-9]{40}$/', $address)) {
            throw new \RuntimeException('Invalid EVM address for ' . $key . '.');
        }
    }

    private static function assertAbsolutePath(string $path, string $key): void
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, "\0")) {
            throw new \RuntimeException('Invalid path for ' . $key . '.');
        }

        if ($path[0] === '/' || $path[0] === '\\') {
            return;
        }

        if (preg_match('~^[a-zA-Z]:[\\\\/]~', $path)) {
            return;
        }

        throw new \RuntimeException('Invalid path for ' . $key . ' (expected absolute path).');
    }
}
