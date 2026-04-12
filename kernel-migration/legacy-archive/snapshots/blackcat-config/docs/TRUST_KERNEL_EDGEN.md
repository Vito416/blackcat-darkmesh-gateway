# Trust Kernel runtime config — Edgen Chain (chain_id 4207)

Network:
- RPC: `https://rpc.layeredge.io`
- RPC (fallback): `https://edgenscan.io/api/eth-rpc`
- Explorer: `https://edgenscan.io`
- Chain ID: `4207`

CLI helpers:

```bash
blackcat config runtime recommend
blackcat config runtime template trust-edgen --json
blackcat config runtime template trust-edgen-portable --json
blackcat config runtime init --force
blackcat config runtime attestation --path=/etc/blackcat/config.runtime.json
```

## Runtime config template (JSON)

Create a runtime config file (recommended: `/etc/blackcat/config.runtime.json`) and fill it with at least:

```json
{
  "crypto": {
    "keys_dir": "/etc/blackcat/keys",
    "agent": {
      "socket_path": "/etc/blackcat/secrets-agent.sock"
    }
  },
  "db": {
    "agent": {
      "socket_path": "/etc/blackcat/secrets-agent.sock"
    },
    "credentials_file": "/etc/blackcat/db.credentials.json"
  },
  "trust": {
    "integrity": {
      "root_dir": "/srv/blackcat",
      "manifest": "/etc/blackcat/integrity.manifest.json",
      "image_digest_file": "/etc/blackcat/image.digest"
    },
    "web3": {
      "chain_id": 4207,
      "rpc_endpoints": ["https://rpc.layeredge.io", "https://edgenscan.io/api/eth-rpc"],
      "rpc_quorum": 2,
      "max_stale_sec": 180,
      "timeout_sec": 5,
      "mode": "full",
      "contracts": {
        "instance_controller": "0xYOUR_INSTALL_INSTANCE_CONTROLLER_CLONE",
        "release_registry": "0x22681Ee2153B7B25bA6772B44c160BB60f4C333E",
        "instance_factory": "0x92C80Cff5d75dcD3846EFb5DF35957D5Aed1c7C5"
      }
    }
  }
}
```

Notes:
- `crypto.agent.socket_path` enables secrets-agent mode (recommended): key files can be root-owned and not readable by the web runtime.
- In TrustKernel deployments, keep DB credentials out of runtime config; use `db.credentials_file` + a privileged agent to release creds conditionally.
- `trust.web3.contracts.instance_controller` must be the **per-install clone** address (not the implementation).
- `trust.web3.contracts.release_registry` is an optional **pin**; the source of truth is the on-chain pointer stored in the `InstanceController`.
- `trust.web3.contracts.instance_factory` is used for **creating instances** during install/upgrade tooling (not required for runtime verification).
- `mode="full"` is the recommended strict default. For compatibility, use `mode="root_uri"` (weaker) explicitly.
- For production, prefer multiple RPC endpoints and `rpc_quorum >= 2` when available.
- `max_stale_sec=180` is the recommended strict default (after stale, runtime must fail closed).

PHP runtime hardening (strict mode):
- In strict policy, `blackcat-core` gates the deployment on critical `php.ini` posture (fail-closed).
- Configure these via `php.ini` / `conf.d` (they are PHP_INI_SYSTEM and cannot be fixed at runtime):
  - `allow_url_include=0`
  - `phar.readonly=1`
  - `cgi.fix_pathinfo=0` (recommended; strict deployments fail-closed when it is enabled on some FPM/CGI setups)
  - `open_basedir` must be set (include your app root + `/etc/blackcat` or equivalent)
  - `disable_functions` should include: `exec,shell_exec,system,passthru,popen,proc_open,pcntl_exec`
  - ensure an outbound Web3 transport exists (recommended: install `ext-curl`; optional: disable `allow_url_fopen`)

## Policy v3: runtime config attestation (recommended)

If you use `TrustPolicyV3` in `InstanceController.activePolicyHash`, the kernel will also verify that the runtime config file is bound to the chain.

Compute the attestation key/value:

```bash
blackcat config runtime attestation
# or
blackcat config runtime attestation --path=/etc/blackcat/config.runtime.json
```

Then set `attestations[key]=value` on your per-install `InstanceController` and lock the key (recommended).

## Validate config (pre-boot)

```php
use BlackCat\Config\Runtime\Config;
use BlackCat\Config\Runtime\RuntimeConfigValidator;

Config::initFromFirstAvailableJsonFile();
RuntimeConfigValidator::assertTrustKernelWeb3Config(Config::repo());
```

## Shared hosting / FTP installs (portable template)

If you cannot use `/etc/blackcat/*` (no root access, shared hosting), use the **portable** template:

```bash
blackcat config runtime template trust-edgen-portable --json > config.runtime.json
# or compat mode (root_uri):
blackcat config runtime template trust-edgen-portable-compat --json > config.runtime.json
```

Key property:
- the portable template uses **relative paths** (resolved relative to the runtime config file location).

Recommended layout:
- keep the runtime config **outside** the web docroot (e.g. next to `/public`)
- place `integrity.manifest.json` next to the runtime config
- keep `trust.integrity.root_dir="."` so the integrity root matches the directory that contains the config + deployed code
