# No-CLI setup (library API)

Some platforms do not allow CLI execution (no `php` binary, blocked `exec()`, restricted filesystem access, etc.).
`blackcat-config` still provides a safe, **fail-closed** setup path via its PHP API.

This document shows how to do the same work as `blackcat config …` without relying on `blackcat-cli`.

## 1) One-call auto init (recommended)

```php
use BlackCat\Config\Runtime\RuntimeConfigInstaller;
use BlackCat\Config\Runtime\Templates\TrustKernelEdgenTemplate;

$seed = TrustKernelEdgenTemplate::build('full'); // or: 'root_uri' for compatibility mode

$res = RuntimeConfigInstaller::initRecommended($seed, true); // force overwrite if needed
// ['path' => '...', 'created' => bool, 'rejected' => [...]]
```

Important:
- `TrustKernelEdgenTemplate` includes placeholders (e.g. `trust.web3.contracts.instance_controller`).
- You must replace them with real deployed contract addresses before boot, otherwise strict validation will fail.

Portable note (shared hosting / FTP):
- if you place your runtime config next to the deployed code root (outside web docroot), you can use:

```php
use BlackCat\Config\Runtime\Templates\TrustKernelEdgenPortableTemplate;

$seed = TrustKernelEdgenPortableTemplate::build('full');
```

## 2) Recommend-only (no writing)

```php
use BlackCat\Config\Runtime\RuntimeConfigInstaller;

$recommendation = RuntimeConfigInstaller::recommendWritePath();
// ['path' => '/etc/blackcat/config.runtime.json', 'reason' => '...']
```

## 3) Load + validate before boot

```php
use BlackCat\Config\Runtime\Config;
use BlackCat\Config\Runtime\RuntimeConfigValidator;

Config::initFromJsonFile('/etc/blackcat/config.runtime.json');

// Fail-closed validation (throws on invalid config):
RuntimeConfigValidator::assertTrustKernelWeb3Config(Config::repo());
RuntimeConfigValidator::assertCryptoConfig(Config::repo());
```

## 4) Inspect security posture (“doctor”)

```php
use BlackCat\Config\Runtime\ConfigRepository;
use BlackCat\Config\Runtime\RuntimeDoctor;

$repo = ConfigRepository::fromJsonFile('/etc/blackcat/config.runtime.json');
$report = RuntimeDoctor::inspect($repo);
// ['ok' => bool, 'findings' => [...], 'summary' => [...], ...]
```

## 5) Compute on-chain attestations (optional hardening)

```php
use BlackCat\Config\Security\KernelAttestations;

$runtimeConfig = Config::repo()->toArray();
$key = KernelAttestations::runtimeConfigAttestationKeyV1();
$value = KernelAttestations::runtimeConfigAttestationValueV1($runtimeConfig);
```

These key/value pairs are designed to be set+locked in `InstanceController.attestations`.

## Important note (security)

Writing `/etc/blackcat/*` from a web runtime is not recommended. Treat runtime config, keys, and DB credentials as **operator-owned** assets:
- create them during installation (root/privileged context),
- lock down permissions (no symlinks, no world-writable dirs),
- keep secrets out of the web runtime (use a local agent boundary where possible).
