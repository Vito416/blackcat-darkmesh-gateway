# Stage 3 — Kernel Minimal Bundle (FTP / no Composer on the server)

Goal: deploy **BlackCat Core + Config** with a strict, fail-closed TrustKernel setup on a server where you can only upload files (FTP/SFTP) and cannot run Composer.

This bundle ships:
- `site/public/index.php` — single entrypoint (front controller)
- `/_blackcat/setup` — one-time installer UI (token-gated), disabled after install

## Important hosting note (why setup may be unavailable)

Some shared hostings are *too constrained* to safely run the web installer:

- **No server-side TLS verification capability** (common: `ext-openssl` disabled; sometimes `ext-curl` disabled too).
- **Outbound HTTPS blocked** (egress restrictions) — the kernel must be able to reach RPC endpoints over HTTPS.
- **Local TLS checks blocked** (some environments disallow loopback/self-connects).

BlackCat intentionally requires **server-side** verification for certain steps (especially setup), because:
- Setup establishes long-lived trust anchors (authorities, policy commitments, release roots).
- If a MITM can intercept/modify setup traffic, they can permanently compromise control of the installation.

If your hosting cannot provide *any* TLS verification path (OpenSSL **or** cURL with HTTPS support), the correct behavior is **fail-closed**.
In that case, do **not** try to bypass setup — use the **offline preparation flow** described below and upload the prepared bundle.

## Hosting preflight (recommended before uploading the bundle)

Before you upload a full bundle, you can run a **single-file** diagnostics check on the target hosting:

1) Upload `blackcat-installer/tools/blackcat-preflight.php` to the hosting docroot (rename it if you want).
2) Open it in a browser:
   - `https://YOUR_DOMAIN/blackcat-preflight.php`
   - JSON output: `https://YOUR_DOMAIN/blackcat-preflight.php?format=json`
   - Policy override: `?policy=strict` (default), `?policy=less-strict`, or `?policy=warn`
     - `strict`: conservative; blocks when `cgi.fix_pathinfo` is enabled.
     - `less-strict`: fail-closed, but may allow `cgi.fix_pathinfo` only if the probe shows **NO EXEC** *and* the install has a locked on-chain probe attestation.
     - `warn`: non-strict evaluation (compatibility only; do not use for production).
   - Best-effort PathInfo probe:
     - Auto-runs when `cgi.fix_pathinfo` is enabled on FPM/CGI.
     - More variants: `?deep=1` (also tests `/index.php`, `;x.php`, etc.)
3) **Delete the file** after checking (it prints environment details).

What it checks (high-level):
- PHP version (kernel-minimal currently requires PHP 8.3+ because of `blackcat-config`)
- Required extensions (`ext-json`, `ext-sodium`, `ext-pdo`)
- TLS verification capability (OpenSSL or cURL SSL)
- Outbound HTTPS connectivity to an Edgen RPC endpoint (basic `eth_chainId`)
- Basic php.ini safety posture (eg. blocks `allow_url_include`)

## 1) Build the bundle (workstation / CI)

From the monorepo root (where `blackcat-core/` and `blackcat-config/` are present):

```bash
bash blackcat-installer/scripts/build-kernel-minimal-bundle.sh
```

Build requirements (on your trusted workstation/CI):
- Either `composer` **or** `docker` must be available (the script will build `site/vendor/`).
- You can force the builder: `BLACKCAT_VENDOR_BUILDER=host|docker` (recommended: `docker` for reproducibility).
- You can skip vendor build only for debugging: `BLACKCAT_VENDOR_BUILDER=skip` (bundle will not boot).

Output:
- `blackcat-installer/dist/blackcat-kernel-minimal-bundle/`
- `blackcat-installer/dist/blackcat-kernel-minimal-bundle.zip`

## 2) Upload to the server

Upload the whole directory (or unzip it on the server):

```
blackcat-kernel-minimal-bundle/
  site/
  .blackcat/
```

Important:
- The web docroot must point to the directory that contains the front controller (`site/public/` in this bundle).
- Keep `.blackcat/` and `config.runtime.json` outside web docroot.

## 3) Run the one-time installer

Open:

`https://YOUR_DOMAIN/_blackcat/setup`

Optional policy selector:
- `https://YOUR_DOMAIN/_blackcat/setup?policy=strict` (default; production)
- `https://YOUR_DOMAIN/_blackcat/setup?policy=less-strict` (fail-closed, but allows a limited set of probe-based waivers)
- `https://YOUR_DOMAIN/_blackcat/setup?policy=warn` (compatibility/dev only; do not use for production)

Flow:
1) The server creates `.blackcat/install.token`.
2) You open that token via FTP and paste it into the setup page.
3) Click **Build manifest** → it writes `.blackcat/integrity.manifest.json` and shows the `root` bytes32.
4) (Optional) Click **Verify release root** (requires a browser wallet) → the installer calls `ReleaseRegistry.isTrustedRoot(root)` and:
   - shows **trusted/untrusted**,
   - blocks instance creation if untrusted (fail-closed).
5) Create the on-chain instance (two options):
   - **Browser wallet** (MetaMask/Rabby): connect wallet, set authority addresses (root / upgrade / emergency), select **enforcement** (strict/less-strict/warn), click **Compute policy hash**, then **Broadcast create tx**.
   - **Manual / offline**: click **Generate tx intent (manual)** and send it from another device / hardware wallet / CLI.
   - This broadcasts `InstanceFactory.createInstance(...)` (and reverts if the root is not trusted).
   - The factory is also an on-chain “installations registry” via `isInstance(...)` + `InstanceCreated` events.
6) Click **Write config** → it writes `config.runtime.json` and prints:
   - runtime-config attestation `key` + `value`
7) Lock the runtime-config attestation (two options):
   - **Browser wallet**: click **Broadcast lock tx**.
   - **Manual / offline**: click **Generate tx intent (manual)** and sign elsewhere.
   - This broadcasts `InstanceController.setAttestationAndLock(key,value)` from the **root authority** wallet.
8) Open the site root and verify it becomes **trusted** in strict mode.
9) Click **Disable installer** → creates `.blackcat/installed.flag` (setup becomes unavailable) and removes the install token.

Notes:
- No private keys are stored server-side. All on-chain transactions are initiated by your wallet.
- After a successful install you may additionally delete `site/_blackcat/setup.php` from the bundle (optional hardening). The front controller will then return `404` for `/_blackcat/setup`.
- `ReleaseRegistry` is a global trust list for **official** BlackCat release roots; end-users should not need to publish anything there.
- If you modify the bundle files after building it, your computed manifest `root` will not match any trusted release root, and instance creation will fail (by design).

## Offline preparation (recommended for constrained hostings)

If your hosting cannot safely run `/_blackcat/setup` (eg. missing OpenSSL/cURL, outbound HTTPS blocked, or you simply want **zero** setup surface on the server),
prepare the bundle on a **trusted device** and only upload the final artifacts.

High-level flow:
1) Build the bundle on a trusted workstation/CI (including `site/vendor/`).
2) Generate the integrity manifest + trust request **offline** (recommended: `blackcat-cli`):
   - build `.blackcat/integrity.manifest.json` for the `site/` directory
   - generate the trust request bundle (policy version 1–5, enforcement strict/less-strict/warn)
   - generate tx intents (manual) and sign from a separate device / hardware wallet
3) Upload the prepared bundle to the hosting (FTP/SFTP), then lock it down:
   - create `.blackcat/installed.flag` (so `/_blackcat/setup` becomes unavailable),
   - optionally remove `site/_blackcat/setup.php`,
   - disable FTP after upload.

This avoids relying on the hosting to perform TLS trust verification during setup.

Important:
- Ensure the generated runtime config matches the **target** deployment:
  - set `http.allowed_hosts` to your real domain (not `localhost`),
  - keep the integrity layout consistent (in this bundle, `trust.integrity.root_dir` points to `site/` and the manifest lives under `.blackcat/`).
- Do not modify bundle files after computing the manifest root; otherwise the on-chain root will not match.

### Offline ceremony (CLI-first, no web installer)

This is the recommended flow for constrained hostings.

Prereqs on your trusted machine:
- `blackcat-cli` available as `blackcat`
- PHP 8.3+

1) Build the bundle locally:

```bash
bash blackcat-installer/scripts/build-kernel-minimal-bundle.sh
```

Assume:
- `BUNDLE=blackcat-installer/dist/blackcat-kernel-minimal-bundle`
- `SITE_DIR=$BUNDLE/site`
- `STATE_DIR=$BUNDLE/.blackcat`

2) Build the integrity manifest for the **site** directory (produces `root` + `uri_hash`):

```bash
php blackcat-core/scripts/trust-integrity-manifest-build.php \
  --root="$SITE_DIR" \
  --out="$STATE_DIR/integrity.manifest.json" \
  --uri="https://example.com/blackcat/kernel-minimal/v1"
```

3) Create the trust request bundle (choose policy version + enforcement):

```bash
blackcat trust request:init \
  --chain-id=4207 \
  --rpc=https://rpc.layeredge.io \
  --mode=full \
  --policy-version=5 \
  --enforcement=strict \
  --root-authority=0x... \
  --upgrade-authority=0x... \
  --emergency-authority=0x... \
  --genesis-root=0x... \
  --genesis-uri-hash=0x... \
  --out=trust-request.json
```

Notes:
- `--genesis-root` and `--genesis-uri-hash` come from step (2).
- Strict production should use **2+** independent RPC endpoints and `rpc_quorum >= 2`.

4) Generate the tx intent for instance creation and broadcast it from your wallet / multisig:

```bash
blackcat trust tx:factory-create \
  --factory=0xYOUR_INSTANCE_FACTORY \
  --request=trust-request.json \
  --out=tx.create-instance.json
```

Broadcast `tx.create-instance.json` from a separate device. After mining, you should have:
- `instance_controller` address (from the receipt / explorer)

5) Generate `config.runtime.json` for the **bundle root** (portable template recommended):

```bash
blackcat config runtime template trust-edgen-portable --json > "$BUNDLE/config.runtime.json"
```

Then edit `$BUNDLE/config.runtime.json` and set at least:
- `http.allowed_hosts` (your real domain)
- `trust.web3.contracts.instance_controller` (from step 4)
- `trust.web3.rpc_endpoints` + `trust.web3.rpc_quorum` (strict: ≥2)
- `trust.integrity.root_dir` and `trust.integrity.manifest` for the bundle layout (portable templates use relative paths)

6) Lock the runtime-config attestation on-chain (policy v3+ hard requirement):

```bash
blackcat trust tx:controller-attest-runtime-config \
  --config="$BUNDLE/config.runtime.json" \
  --out=tx.attest-runtime-config.json
```

Broadcast `tx.attest-runtime-config.json` from the **rootAuthority** wallet.

7) (Optional) If your hosting requires `policy=less-strict` due to `cgi.fix_pathinfo`:
- Run `blackcat-preflight.php` in `less-strict` and ensure the PathInfo probe shows **NO EXEC**.
- Lock the on-chain probe attestation (rootAuthority):

```bash
blackcat trust tx:controller-attest-pathinfo-noexec \
  --config="$BUNDLE/config.runtime.json" \
  --out=tx.attest-pathinfo-noexec.json
```

8) Lock down the server install:
- ensure the bundle root contains:
  - `config.runtime.json`
  - `.blackcat/integrity.manifest.json`
  - `.blackcat/installed.flag`
- upload `site/` and `.blackcat/` via FTP/SFTP
- disable FTP after upload

At this point the application should boot **trusted** (strict) and fail-closed on any tampering.

## 4) Troubleshooting

- If you see `503` at `/`:
  - open `/_blackcat/setup` and verify `config.runtime.json` exists,
  - ensure you have **2+** working RPC endpoints if running strict quorum >= 2,
  - verify the on-chain `activeRoot` matches the local manifest `root`.

- If setup says “HTTPS required”:
  - enable TLS (Let’s Encrypt) and ensure the app is not downgraded to HTTP between proxy and PHP.

- If setup says “trusted TLS required”:
  - setup is fail-closed until the HTTPS certificate validates against a trusted CA,
  - fix TLS (recommended: Let’s Encrypt) and reload.
  - For local demos, self-signed certificates may be tolerated, but do not treat them as production-safe.

- If setup says “preflight failed” and mentions TLS verification:
  - the installer needs a server-side way to verify CA trust (OpenSSL extension **or** PHP cURL with HTTPS support),
  - if your hosting cannot provide either, use the **Offline preparation** flow and do not run setup on the server.

- If instance creation fails:
  - ensure MetaMask is on **Edgen Chain** (`chain_id=4207`) and your wallet has enough EDGEN for gas,
  - ensure you uploaded an **untampered** official bundle (otherwise `GenesisRootNotTrusted` is expected),
  - ensure your authority addresses are valid `0x...` EVM addresses.

## Local demo (Docker / localhost)

If you want to preview the setup UI locally (and iterate on visuals), a self-contained HTTPS demo stack is included:

```bash
docker compose -f blackcat-installer/docker-compose.stage3-demo.yml up --build
```

Then open:

`https://localhost:8449/_blackcat/setup`

For live UI editing (no rebuild needed):

```bash
docker compose \
  -f blackcat-installer/docker-compose.stage3-demo.yml \
  -f blackcat-installer/docker-compose.stage3-demo.dev.yml \
  up --build
```

Notes:
- The certificate is self-signed (your browser will warn).
- This is expected for local demo; the setup UI will show a persistent **DEV WARNING** banner.
- To read the install token for local testing:

```bash
docker compose -f blackcat-installer/docker-compose.stage3-demo.yml exec stage3-demo cat /srv/bundle/.blackcat/install.token
```
