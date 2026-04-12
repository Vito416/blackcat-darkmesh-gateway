<?php

declare(strict_types=1);

namespace BlackCat\Config\Runtime;

use BlackCat\Config\Security\ConfigDirPolicy;
use BlackCat\Config\Security\ConfigFilePolicy;
use BlackCat\Config\Security\KernelAttestations;
use BlackCat\Config\Security\SecureDir;
use BlackCat\Config\Security\SecureFile;
use BlackCat\Config\Security\SecurityException;

/**
 * @phpstan-type RuntimeFinding array{
 *   severity:'info'|'warn'|'error',
 *   code:string,
 *   message:string,
 *   meta?:array<string,mixed>
 * }
 */
final class RuntimeDoctor
{
    /**
     * @return array{
     *   ok:bool,
     *   ok_strict:bool,
     *   tier:'strong'|'medium'|'compat',
     *   source_path:?string,
     *   findings:list<array{
     *     severity:'info'|'warn'|'error',
     *     code:string,
     *     message:string,
     *     meta?:array<string,mixed>
     *   }>,
     *   summary:array{errors:int,warnings:int,infos:int}
     * }
     */
    public static function inspect(ConfigRepository $repo): array
    {
        /** @var list<RuntimeFinding> $findings */
        $findings = [];

        /** @var callable('info'|'warn'|'error', string, string, array<string,mixed>|null):void $add */
        /**
         * @param 'info'|'warn'|'error' $severity
         * @param array<string,mixed>|null $meta
         */
        $add = static function (string $severity, string $code, string $message, ?array $meta = null) use (&$findings): void {
            /** @var RuntimeFinding $row */
            $row = [
                'severity' => $severity,
                'code' => $code,
                'message' => $message,
            ];
            if ($meta !== null && $meta !== []) {
                /** @var array<string,mixed> $normalizedMeta */
                $normalizedMeta = [];
                foreach ($meta as $k => $v) {
                    if (is_string($k) && $k !== '' && !ctype_digit($k)) {
                        $normalizedMeta[$k] = $v;
                    }
                }
                if ($normalizedMeta !== []) {
                    $row['meta'] = $normalizedMeta;
                }
            }
            $findings[] = $row;
        };

        $sourcePath = $repo->sourcePath();
        if ($sourcePath === null) {
            $add('warn', 'runtime_config_source_unknown', 'Runtime config has no known source path (in-memory repo).', null);
        } else {
            try {
                SecureFile::assertSecureReadableFile($sourcePath, ConfigFilePolicy::strict());
                $add('info', 'runtime_config_file_ok', 'Runtime config file passes strict file policy.', [
                    'path' => $sourcePath,
                ]);
            } catch (SecurityException $e) {
                $add('error', 'runtime_config_file_insecure', 'Runtime config file is not secure under strict policy.', [
                    'path' => $sourcePath,
                    'reason' => $e->getMessage(),
                ]);
            }

            if (str_starts_with(str_replace('\\', '/', $sourcePath), '/mnt/')) {
                $add(
                    'warn',
                    'runtime_config_on_windows_mount',
                    'Runtime config is stored on a Windows mount (/mnt/*). Prefer WSL filesystem or a Linux volume for security-critical config.',
                    ['path' => $sourcePath],
                );
            }
        }

        self::runValidatorChecks($repo, $add);
        self::checkRecommendedTrustKernelPosture($repo, $add);
        self::checkRecommendedSecretsBoundary($repo, $add);
        self::checkTxOutboxDir($repo, $add);
        self::checkRecommendedKernelAttestations($repo, $add);
        self::checkPathHeuristics($repo, $add);
        self::checkPhpIniPosture($add);

        $summary = [
            'errors' => 0,
            'warnings' => 0,
            'infos' => 0,
        ];
        foreach ($findings as $finding) {
            $sev = $finding['severity'];
            if ($sev === 'error') {
                $summary['errors']++;
            } elseif ($sev === 'warn') {
                $summary['warnings']++;
            } else {
                $summary['infos']++;
            }
        }

        $tier = self::deriveTier($repo, $findings);

        $ok = $summary['errors'] === 0;
        $okStrict = $summary['errors'] === 0 && $summary['warnings'] === 0;

        return [
            'ok' => $ok,
            'ok_strict' => $okStrict,
            'tier' => $tier,
            'source_path' => $sourcePath,
            'findings' => $findings,
            'summary' => $summary,
        ];
    }

    /**
     * @param callable('info'|'warn'|'error', string, string, array<string,mixed>|null):void $add
     */
    private static function runValidatorChecks(ConfigRepository $repo, callable $add): void
    {
        $checks = [
            'http' => static function () use ($repo): void {
                RuntimeConfigValidator::assertHttpConfig($repo);
            },
            'crypto' => static function () use ($repo): void {
                RuntimeConfigValidator::assertCryptoConfig($repo);
            },
            'db' => static function () use ($repo): void {
                RuntimeConfigValidator::assertDbConfig($repo);
            },
            'observability' => static function () use ($repo): void {
                RuntimeConfigValidator::assertObservabilityConfig($repo);
            },
            'trust.web3' => static function () use ($repo): void {
                RuntimeConfigValidator::assertTrustKernelWeb3Config($repo);
            },
        ];

        foreach ($checks as $name => $fn) {
            try {
                $fn();
                $add('info', 'config_valid_' . $name, 'Runtime config section validated: ' . $name, null);
            } catch (\Throwable $e) {
                // Treat missing optional sections as info, not errors.
                $raw = $repo->get($name);
                if ($raw === null && in_array($name, ['http', 'crypto', 'db', 'observability', 'trust.web3'], true)) {
                    $add('info', 'config_missing_' . $name, 'Runtime config section not present: ' . $name, null);
                    continue;
                }
                $add('error', 'config_invalid_' . $name, 'Runtime config validation failed for: ' . $name, [
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * @param callable('info'|'warn'|'error', string, string, array<string,mixed>|null):void $add
     */
    private static function checkRecommendedTrustKernelPosture(ConfigRepository $repo, callable $add): void
    {
        $web3 = $repo->get('trust.web3');
        if ($web3 === null) {
            $add(
                'warn',
                'trust_kernel_not_configured',
                'TrustKernel (trust.web3) is not configured; integrity checks and fail-closed enforcement are disabled.',
                null,
            );
            return;
        }

        $endpoints = $repo->get('trust.web3.rpc_endpoints');
        $count = is_array($endpoints) ? count($endpoints) : 0;

        $quorum = null;
        $qRaw = $repo->get('trust.web3.rpc_quorum');
        if (is_int($qRaw)) {
            $quorum = $qRaw;
        } elseif (is_string($qRaw) && ctype_digit(trim($qRaw))) {
            $quorum = (int) trim($qRaw);
        }

        if ($count > 0 && $quorum !== null && ($count < 2 || $quorum < 2)) {
            $add(
                'warn',
                'rpc_quorum_insecure_for_strict',
                'Strict TrustKernel policy requires at least 2 independent RPC endpoints and quorum >= 2. With quorum=1 a single RPC can lie about on-chain state.',
                [
                    'rpc_endpoints_count' => $count,
                    'rpc_quorum' => $quorum,
                ]
            );
        }
    }

    /**
     * @param callable('info'|'warn'|'error', string, string, array<string,mixed>|null):void $add
     */
    private static function checkRecommendedSecretsBoundary(ConfigRepository $repo, callable $add): void
    {
        if ($repo->get('trust.web3') === null) {
            return;
        }

        $cryptoAgent = $repo->get('crypto.agent.socket_path');
        if (!is_string($cryptoAgent) || trim($cryptoAgent) === '') {
            $add(
                'warn',
                'crypto_agent_missing',
                'crypto.agent.socket_path is not configured. Key material may need to be readable by the web runtime (higher exfil risk on RCE). Prefer secrets-agent mode.',
                null,
            );
        }

        $dbAgent = $repo->get('db.agent.socket_path');
        if ($repo->get('db') !== null && (!is_string($dbAgent) || trim($dbAgent) === '')) {
            $add(
                'warn',
                'db_agent_missing',
                'db.agent.socket_path is not configured. DB credentials may be exposed to the web runtime unless a secrets boundary is used.',
                null,
            );
        }
    }

    /**
     * @param callable('info'|'warn'|'error', string, string, array<string,mixed>|null):void $add
     */
    private static function checkTxOutboxDir(ConfigRepository $repo, callable $add): void
    {
        if ($repo->get('trust.web3') === null) {
            return;
        }

        $txOutbox = $repo->get('trust.web3.tx_outbox_dir');
        if ($txOutbox === null || $txOutbox === '') {
            $add(
                'warn',
                'tx_outbox_not_configured',
                'trust.web3.tx_outbox_dir is not configured. Recommended for buffering on-chain incident/check-in transactions via external relayers.',
                null,
            );
            return;
        }

        if (!is_string($txOutbox)) {
            return;
        }

        try {
            $resolved = $repo->resolvePath($txOutbox);
            SecureDir::assertSecureReadableDir($resolved, ConfigDirPolicy::txOutboxDir());
            if (!is_writable($resolved)) {
                $add('warn', 'tx_outbox_not_writable', 'Configured tx outbox directory is not writable by this process.', [
                    'path' => $resolved,
                ]);
            } else {
                $add('info', 'tx_outbox_ok', 'Tx outbox directory is configured and writable.', [
                    'path' => $resolved,
                ]);
            }
        } catch (\Throwable $e) {
            $add('warn', 'tx_outbox_invalid', 'Tx outbox directory is configured but does not satisfy security policy.', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Heuristics that are hard to express in schema validation but matter for security posture.
     *
     * @param callable('info'|'warn'|'error', string, string, array<string,mixed>|null):void $add
     */
    private static function checkPathHeuristics(ConfigRepository $repo, callable $add): void
    {
        $docRoot = self::documentRoot();
        $docRootNorm = $docRoot !== null ? self::normalizeFsPath($docRoot) : null;

        /** @var list<array{key:string,label:string,docroot_severity:'warn'|'error'}> $keys */
        $keys = [
            ['key' => 'crypto.keys_dir', 'label' => 'crypto.keys_dir', 'docroot_severity' => 'error'],
            ['key' => 'crypto.manifest', 'label' => 'crypto.manifest', 'docroot_severity' => 'warn'],
            ['key' => 'crypto.agent.socket_path', 'label' => 'crypto.agent.socket_path', 'docroot_severity' => 'error'],
            ['key' => 'db.credentials_file', 'label' => 'db.credentials_file', 'docroot_severity' => 'error'],
            ['key' => 'db.agent.socket_path', 'label' => 'db.agent.socket_path', 'docroot_severity' => 'error'],
            ['key' => 'trust.integrity.root_dir', 'label' => 'trust.integrity.root_dir', 'docroot_severity' => 'warn'],
            ['key' => 'trust.integrity.manifest', 'label' => 'trust.integrity.manifest', 'docroot_severity' => 'warn'],
            ['key' => 'trust.integrity.image_digest_file', 'label' => 'trust.integrity.image_digest_file', 'docroot_severity' => 'warn'],
            ['key' => 'trust.web3.tx_outbox_dir', 'label' => 'trust.web3.tx_outbox_dir', 'docroot_severity' => 'error'],
            ['key' => 'observability.storage_dir', 'label' => 'observability.storage_dir', 'docroot_severity' => 'warn'],
        ];

        foreach ($keys as $row) {
            $raw = $repo->get($row['key']);
            if (!is_string($raw) || trim($raw) === '') {
                continue;
            }

            $raw = trim($raw);
            $resolved = $raw;
            try {
                $resolved = $repo->resolvePath($raw);
            } catch (\Throwable) {
                // best-effort: still report heuristics on raw value
                $resolved = $raw;
            }

            $pathNorm = self::normalizeFsPath($resolved);

            if ($pathNorm !== null && str_starts_with($pathNorm, '/mnt/')) {
                $add(
                    'warn',
                    'path_on_windows_mount',
                    $row['label'] . ' is on a Windows-mounted filesystem (/mnt/*). Prefer a Linux volume/WSL filesystem for security-critical paths.',
                    ['key' => $row['key'], 'path' => $resolved],
                );
            }

            if (self::isLikelyTemporaryPath($pathNorm ?? $resolved)) {
                $add(
                    'warn',
                    'path_temporary_location',
                    $row['label'] . ' appears to be in a temporary directory. Prefer a persistent dedicated location.',
                    ['key' => $row['key'], 'path' => $resolved],
                );
            }

            if ($docRootNorm !== null && $pathNorm !== null && self::isPathWithin($pathNorm, $docRootNorm)) {
                $severity = $row['docroot_severity'];
                $add(
                    $severity,
                    'path_inside_document_root',
                    $row['label'] . ' is located inside the web document root. This can expose secrets/control-plane files to HTTP; move it outside docroot.',
                    [
                        'key' => $row['key'],
                        'path' => $resolved,
                        'document_root' => $docRootNorm,
                    ],
                );
            }
        }
    }

    /**
     * @param callable('info'|'warn'|'error', string, string, array<string,mixed>|null):void $add
     */
    private static function checkPhpIniPosture(callable $add): void
    {
        $get = static function (string $key): ?string {
            $v = ini_get($key);
            return is_string($v) ? $v : null;
        };

        $flag = static function (?string $v): ?bool {
            if ($v === null) {
                return null;
            }
            $t = strtolower(trim($v));
            if ($t === '') {
                return null;
            }
            if (in_array($t, ['1', 'on', 'yes', 'true'], true)) {
                return true;
            }
            if (in_array($t, ['0', 'off', 'no', 'false'], true)) {
                return false;
            }
            if (ctype_digit($t)) {
                return ((int) $t) !== 0;
            }
            return null;
        };

        $parseCsv = static function (?string $raw): array {
            if ($raw === null || trim($raw) === '') {
                return [];
            }
            $out = [];
            foreach (preg_split('/[\\s,]+/', trim($raw)) ?: [] as $part) {
                $p = strtolower(trim((string) $part));
                if ($p === '' || str_contains($p, "\0")) {
                    continue;
                }
                $out[$p] = true;
            }
            return array_keys($out);
        };

        $openBasedir = $get('open_basedir');
        if ($openBasedir === null || trim($openBasedir) === '') {
            $add(
                'warn',
                'php_open_basedir_unset',
                'open_basedir is not set. Strict TrustKernel policy will fail-closed; set open_basedir to include your code root + /etc/blackcat + /var/lib/blackcat.',
                null,
            );
        }

        $allowUrlInclude = $flag($get('allow_url_include'));
        if ($allowUrlInclude === true) {
            $add('warn', 'php_allow_url_include_enabled', 'allow_url_include is enabled (high-risk RFI). Set allow_url_include=0.', null);
        }

        $pharReadonly = $flag($get('phar.readonly'));
        if ($pharReadonly === false) {
            $add('warn', 'php_phar_readonly_disabled', 'phar.readonly is disabled. Set phar.readonly=1 to reduce PHAR deserialization risks.', null);
        }

        $displayErrors = $flag($get('display_errors'));
        $displayStartupErrors = $flag($get('display_startup_errors'));
        if ($displayErrors === true || $displayStartupErrors === true) {
            $add(
                'warn',
                'php_display_errors_enabled',
                'display_errors/display_startup_errors is enabled (information disclosure). Set display_errors=0 and display_startup_errors=0.',
                null,
            );
        }

        $enableDl = $flag($get('enable_dl'));
        if ($enableDl === true) {
            $add('warn', 'php_enable_dl_enabled', 'enable_dl is enabled (runtime extension loading increases attack surface). Set enable_dl=0.', null);
        }

        $autoPrependFile = $get('auto_prepend_file');
        if (is_string($autoPrependFile) && trim($autoPrependFile) !== '') {
            $add(
                'warn',
                'php_auto_prepend_file_set',
                'auto_prepend_file is set; this increases the risk of hidden code injection. Prefer leaving it empty.',
                ['value' => trim($autoPrependFile)],
            );
        }

        $autoAppendFile = $get('auto_append_file');
        if (is_string($autoAppendFile) && trim($autoAppendFile) !== '') {
            $add(
                'warn',
                'php_auto_append_file_set',
                'auto_append_file is set; this increases the risk of hidden code injection. Prefer leaving it empty.',
                ['value' => trim($autoAppendFile)],
            );
        }

        $cgiFixPathinfo = $flag($get('cgi.fix_pathinfo'));
        if ($cgiFixPathinfo === true && in_array(PHP_SAPI, ['fpm-fcgi', 'cgi', 'cgi-fcgi'], true)) {
            $add(
                'warn',
                'php_cgi_fix_pathinfo_enabled',
                'cgi.fix_pathinfo is enabled (risk in some FPM/CGI configurations). Set cgi.fix_pathinfo=0.',
                null,
            );
        }

        $allowUrlFopen = $flag($get('allow_url_fopen'));
        $curlAvailable = function_exists('curl_init')
            && function_exists('curl_setopt_array')
            && function_exists('curl_exec')
            && function_exists('curl_getinfo')
            && function_exists('curl_close');

        if (!$curlAvailable && $allowUrlFopen === false) {
            $add(
                'warn',
                'php_no_transport_for_web3',
                'Neither ext-curl is available nor allow_url_fopen is enabled. TrustKernel Web3 transport will not work.',
                null,
            );
        }

        $disableFunctions = $get('disable_functions');
        $dangerous = [
            'exec',
            'shell_exec',
            'system',
            'passthru',
            'popen',
            'proc_open',
            'pcntl_exec',
        ];

        // Treat "callable" as the real risk. If a function is disabled by disable_functions or unavailable
        // (extension not loaded), function_exists() should be false.
        $callable = [];
        foreach ($dangerous as $fn) {
            if (function_exists($fn)) {
                $callable[] = $fn;
            }
        }

        if ($disableFunctions === null || trim($disableFunctions) === '') {
            if ($callable !== []) {
                $add(
                    'warn',
                    'php_disable_functions_empty',
                    'disable_functions is empty and some dangerous process-exec functions are callable: ' . implode(',', $callable),
                    ['callable' => $callable],
                );
            } else {
                $add(
                    'info',
                    'php_disable_functions_effectively_disabled',
                    'disable_functions is empty, but no dangerous process-exec functions appear callable in this runtime.',
                    null,
                );
            }
        } elseif ($callable !== []) {
            $add(
                'warn',
                'php_disable_functions_missing_dangerous',
                'Some dangerous process-exec functions appear callable: ' . implode(',', $callable) . ' (recommended to disable via disable_functions).',
                ['callable' => $callable],
            );
        }
    }

    /**
     * @param callable('info'|'warn'|'error', string, string, array<string,mixed>|null):void $add
     */
    private static function checkRecommendedKernelAttestations(ConfigRepository $repo, callable $add): void
    {
        if ($repo->get('trust.web3') === null) {
            return;
        }

        // ===== http.allowed_hosts (policy v5) =====
        $allowedHosts = $repo->get('http.allowed_hosts');
        if ($allowedHosts === null || $allowedHosts === '') {
            $add(
                'warn',
                'attestation_http_allowed_hosts_missing',
                'http.allowed_hosts is not configured. Trust policy v5 requires an on-chain host allowlist commitment.',
                null,
            );
        } elseif (is_array($allowedHosts)) {
            try {
                $payload = KernelAttestations::httpAllowedHostsPayloadV1($allowedHosts);
                $key = KernelAttestations::httpAllowedHostsAttestationKeyV1();
                $value = \BlackCat\Config\Security\CanonicalJson::sha256Bytes32($payload);

                $add('info', 'attestation_http_allowed_hosts_ready', 'HTTP allowed hosts attestation computed (policy v5).', [
                    'key' => $key,
                    'value' => $value,
                    'hosts' => $payload['hosts'],
                ]);
            } catch (\Throwable $e) {
                $add('warn', 'attestation_http_allowed_hosts_unavailable', 'http.allowed_hosts exists but cannot be used for attestation.', [
                    'error' => $e->getMessage(),
                ]);
            }
        } else {
            $add('warn', 'attestation_http_allowed_hosts_unavailable', 'http.allowed_hosts exists but cannot be used for attestation.', [
                'error' => 'Invalid type (expected list of strings).',
            ]);
        }

        // ===== composer.lock (optional) =====
        $rootDirRaw = $repo->get('trust.integrity.root_dir');
        if (is_string($rootDirRaw) && trim($rootDirRaw) !== '') {
            try {
                $rootDir = $repo->resolvePath($rootDirRaw);
                $composerLock = rtrim($rootDir, "/\\") . DIRECTORY_SEPARATOR . 'composer.lock';
                if (!is_file($composerLock)) {
                    $add('warn', 'attestation_composer_lock_missing', 'composer.lock not found under trust.integrity.root_dir (optional on-chain attestation).', [
                        'expected_path' => $composerLock,
                    ]);
                } else {
                    try {
                        $policy = new ConfigFilePolicy(
                            allowSymlinks: false,
                            allowWorldReadable: true,
                            allowGroupWritable: false,
                            allowWorldWritable: false,
                            maxBytes: 8 * 1024 * 1024,
                            checkParentDirs: true,
                            enforceOwner: false,
                        );
                        SecureFile::assertSecureReadableFile($composerLock, $policy);
                        $raw = file_get_contents($composerLock);
                        if ($raw === false) {
                            throw new \RuntimeException('Unable to read composer.lock');
                        }

                        /** @var mixed $decoded */
                        $decoded = json_decode($raw, true);
                        if (!is_array($decoded)) {
                            throw new \RuntimeException('composer.lock must decode to an object/array.');
                        }

                        /** @var array<string,mixed> $decoded */
                        $key = KernelAttestations::composerLockAttestationKeyV1();
                        $value = KernelAttestations::composerLockAttestationValueV1($decoded);

                        $add('info', 'attestation_composer_lock_ready', 'composer.lock attestation computed (optional hardening).', [
                            'path' => $composerLock,
                            'key' => $key,
                            'value' => $value,
                        ]);
                    } catch (\Throwable $e) {
                        $add('warn', 'attestation_composer_lock_unavailable', 'composer.lock exists but cannot be used for attestation.', [
                            'path' => $composerLock,
                            'error' => $e->getMessage(),
                        ]);
                    }
                }
            } catch (\Throwable $e) {
                $add('warn', 'attestation_composer_lock_unknown', 'Unable to locate composer.lock under trust.integrity.root_dir.', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // ===== PHP fingerprint (optional) =====
        try {
            $payload = KernelAttestations::phpFingerprintPayloadV2();
            $value = KernelAttestations::phpFingerprintAttestationValueV2($payload);
            $add('info', 'attestation_php_fingerprint_ready', 'PHP fingerprint attestation computed (optional hardening).', [
                'key' => KernelAttestations::phpFingerprintAttestationKeyV2(),
                'value' => $value,
            ]);
        } catch (\Throwable $e) {
            $add('warn', 'attestation_php_fingerprint_failed', 'Unable to compute PHP fingerprint attestation.', [
                'error' => $e->getMessage(),
            ]);
        }

        // ===== Image digest (optional) =====
        $digestPath = '/etc/blackcat/image.digest';
        $digestPathRaw = $repo->get('trust.integrity.image_digest_file');
        if (is_string($digestPathRaw) && trim($digestPathRaw) !== '') {
            try {
                $digestPath = $repo->resolvePath($digestPathRaw);
            } catch (\Throwable) {
                $digestPath = trim($digestPathRaw);
            }
        }
        if (is_file($digestPath) && !is_link($digestPath)) {
            try {
                SecureFile::assertSecureReadableFile($digestPath, ConfigFilePolicy::publicReadable());
                $raw = file_get_contents($digestPath);
                if ($raw === false) {
                    throw new \RuntimeException('Unable to read image digest file.');
                }
                $value = KernelAttestations::imageDigestAttestationValueV1($raw);
                $add('info', 'attestation_image_digest_ready', 'Image digest attestation loaded (optional hardening).', [
                    'path' => $digestPath,
                    'key' => KernelAttestations::imageDigestAttestationKeyV1(),
                    'value' => $value,
                ]);
            } catch (\Throwable $e) {
                $add('warn', 'attestation_image_digest_unavailable', 'Image digest file exists but cannot be used for attestation.', [
                    'path' => $digestPath,
                    'error' => $e->getMessage(),
                ]);
            }
        } else {
            $add('warn', 'attestation_image_digest_missing', 'Image digest file not found (optional on-chain attestation).', [
                'expected_path' => $digestPath,
            ]);
        }
    }

    /**
     * @param list<array{severity:'info'|'warn'|'error',code:string,message:string,meta?:array<string,mixed>}> $findings
     * @return 'strong'|'medium'|'compat'
     */
    private static function deriveTier(ConfigRepository $repo, array $findings): string
    {
        $hasWeb3 = $repo->get('trust.web3') !== null;
        if (!$hasWeb3) {
            return 'compat';
        }

        $hasErrors = false;
        $hasWarnings = false;
        foreach ($findings as $f) {
            if ($f['severity'] === 'error') {
                $hasErrors = true;
            } elseif ($f['severity'] === 'warn') {
                $hasWarnings = true;
            }
        }

        if ($hasErrors) {
            return 'compat';
        }
        if ($hasWarnings) {
            return 'medium';
        }
        return 'strong';
    }

    private static function documentRoot(): ?string
    {
        $candidates = [
            $_SERVER['CONTEXT_DOCUMENT_ROOT'] ?? null,
            $_SERVER['DOCUMENT_ROOT'] ?? null,
        ];

        foreach ($candidates as $raw) {
            if (!is_string($raw)) {
                continue;
            }
            $raw = trim($raw);
            if ($raw === '' || str_contains($raw, "\0")) {
                continue;
            }
            return $raw;
        }

        return null;
    }

    private static function normalizeFsPath(string $path): ?string
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, "\0")) {
            return null;
        }

        $real = @realpath($path);
        if (is_string($real) && $real !== '') {
            $path = $real;
        }

        $path = str_replace('\\', '/', $path);
        $path = rtrim($path, '/');
        if ($path === '') {
            $path = '/';
        }

        if (DIRECTORY_SEPARATOR === '\\') {
            $path = strtolower($path);
        }

        return $path;
    }

    private static function isPathWithin(string $child, string $parent): bool
    {
        $parent = rtrim($parent, '/');
        if ($parent === '') {
            $parent = '/';
        }

        if ($parent === '/') {
            return str_starts_with($child, '/');
        }

        return $child === $parent || str_starts_with($child, $parent . '/');
    }

    private static function isLikelyTemporaryPath(string $path): bool
    {
        $path = str_replace('\\', '/', trim($path));
        if ($path === '') {
            return false;
        }

        return str_starts_with($path, '/tmp/')
            || str_starts_with($path, '/var/tmp/')
            || str_starts_with($path, '/run/')
            || str_starts_with($path, '/dev/shm/');
    }
}
