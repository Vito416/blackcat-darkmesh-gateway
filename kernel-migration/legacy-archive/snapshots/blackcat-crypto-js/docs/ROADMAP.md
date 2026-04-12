# @blackcat/crypto – Roadmap

## Stage 1 – Foundation ✅
- `config/crypto.example.json` + loader (`loadCryptoConfig`) s podporou `${env:}`/`${file:}` placeholderů a `blackcat-config` profilů.
- CLI `bin/crypto-js` (`config:show`, `checks:run`, `workflows:list|run`, `slots:list|sign`, `telemetry:tail`).
- Telemetry + Prometheus metrics (`var/log/crypto-js.ndjson`, `var/metrics/crypto-js.prom`) + vitest smoke testy.
- WebCrypto helpers: `Envelope`, `LocalCipher`, `HmacSlot`, `SlotRegistry`, `WorkflowRunner`.

## Stage 2 – HMAC Slots + Auth Integrace (in progress)
- Rozšířit `SlotRegistry` o rotaci slotů dle `@blackcat/auth` manifestů.
- CLI `slots:sync` napojená na `blackcat-auth` (přímé načtení seeds z CLI / API).
- Persistované sloty pro browser/Node runtimy (IndexedDB + secure storage).
- Rozšířit testy o contract testy vs. `blackcat-auth` a `blackcat-crypto`.

## Stage 3 – PQC Ready
- Hybridní režim (Kyber + AES-GCM SIV) – přijímá metadata z API, umožňuje pre-wrap.
- Secure key storage (IndexedDB) + background rotace.

## Stage 4 – Cross-Ecosystem Automation
- Wire blackcat-crypto-js services into installer/orchestrator pipelines for push-button deployments.
- Expand contract tests covering dependencies listed in ECOSYSTEM.md.
- Publish metrics/controls so observability, security, and governance repos can reason about blackcat-crypto-js automatically.

## Stage 5 – Continuous AI Augmentation
- Ship AI-ready manifests/tutorials enabling GPT installers to compose blackcat-crypto-js stacks autonomously.
- Add self-healing + policy feedback loops leveraging blackcat-agent, blackcat-governance, and marketplace signals.
- Feed anonymized adoption data to blackcat-usage and reward contributors via blackcat-payout.

## Stage 6 – Edge Runtime & WASM
- WASM balíček pro serverless/edge prostředí (Cloudflare Workers, Deno Deploy) se sdílenými manifesty.
- Deterministic storage: IndexedDB/Cache API persistence s KMS handshake proti `blackcat-crypto`.
- CLI `edge:bundle` pro generování runtime-specific buildů (rollup/esbuild).

## Stage 7 – Compliance & Policy Sync
- Automatické stahování `blackcat-crypto-manifests` + validace proti `vault:report` výstupům (CI hooky).
- Telemetry export (OpenTelemetry spans) pro audit dráhy (encrypt/decrypt/HMAC) – napojení na `blackcat-observability`.
- `slots:policy` CLI pro porovnání s `blackcat-governance` politikami (fail build, pokud chybí slot).

## Next TODO (darkmesh gateway/browser)
- Ship minimal bundle for browser + CF Worker: encrypt/HMAC envelopes for gateway/worker flows using manifest slots (`core.crypto.default`, `core.hmac.csrf`).
- CLI `slots:sync --manifest ../blackcat-crypto-manifests/contexts/core.json` to pin slots used by gateway/web templates; emit hash for Arweave manifest publish.
- Add contract tests against gateway/worker sample payloads (round-trip encrypt/decrypt, HMAC verify).
- Provide TS helpers for “encrypt form payload + attach PSP token” pattern (used by darkmesh web templates).

## Stage 8 – AI-assisted SDK
- Generátor type-safe hooků (`useEncryptedField`, `useVaultContext`) poháněný manifesty a `blackcat-ai`.
- Self-healing sample apps: CLI `crypto-js doctor` spustí end-to-end scénáře, navrhne fixy.
- Marketplace integrace (sharing pluginů, templates) s telemetry backfeed do `blackcat-marketplace`.

## Stage 9 – Federated Secrets Governance
- SSE feed/telemetry tail pro tenant-specific rewraps, governance alerts, auto-fencing nezdravých klientů.
- Tenant-aware wrap queue (browser + Node) a shared manifest sloty s `blackcat-crypto`/`blackcat-crypto-kms`.
- Bridge pro `blackcat-core` a DB SDK: jednotný envelope formát + HMAC sloty napříč front/back/DB.

## Stage 10 – Vault Streaming & Policy Mesh
- Streamované vault operace (chunked encrypt/decrypt) s audit metadaty (`key_id`, manifest context).
- CLI `vault:*` parity s PHP: diag/report/migrate + fail-on-warn mód pro CI.
- Policy mesh: manifesty (`blackcat-crypto-manifests`) validované napříč SDK (JS, Rust) + backendy.

## Stage 11 – Data Plane Fusion
- Transparent field encryption hooks pro GraphQL/REST klienty a DB SDK, telemetry intents do traces.
- Self-service governance portal integration (approvals, regeneration of SDK bundles).
- `vault:report --fail-on-unused` enforcement v CI, export do compliance dashboardů.

## Stage 12 – Autonomous Compliance Mesh
- Auto-runbooky: drift → trigger rewrap/migrate, ticketing, governance approvals.
- AI návrhy kontextů z datových profilů, generování PR do manifests repo.
- Cross-cloud KMS handshake (crypto-kms/hsm) sdílí manifesty + telemetry s JS clienty.

## Stage 13 – Trustless Proofs & Customer Control
- Podepsané audit eventy (wrap/unwrap/HMAC) + Merkle proofs exportovatelné do SIEM.
- BYOK/BYO-KMS: tenant může spravovat sloty, geo-fence, suspend bez ztráty kompatibility.
- Attestation-first decrypt: no-plaintext režimy pro citlivé tenancy.

## Stage 14 – MPC / Threshold Fabric
- Experimentální threshold HMAC/AEAD (FROST/Shamir) pro vybrané flows, s fallback routováním.
- Disaster policies: air-gap KMS, geo-sealed queues, scripted recovery.
- CISO/SRE panely: risk score slotů, simulace výpadků, doporučené runbooky.

## Stage 15 – Attested Edge & BYOK at Scale
- TEE/HSM attestation pro edge runtimy (WASM/Workers) před wrap/unwrap.
- Self-service BYO-KMS registrace s health-checkem a rollbackem; adaptive routing podle rizika/geo.
- Real-time policy updates bez výpadků (hot-reload manifestů a slotů v prohlížeči/Node).

## Stage 16 – Zero-Touch Assurance
- Proof bundles (Merkle + signatures) pro každý request, export do SIEM/forensics.
- Auto runbooky pro incident: fence KMS klienty, reroute, audit feed do governance.
- Read-only/kill-switch režim pro high-risk tenanty s řízeným návratem.

## Stage 17 – Privacy-Preserving Analytics
- Volitelné HE/TEE kanály pro agregace bez dešifrování, bezpečné feedy do analytics/AI.
- Dual-control dotazy: risk scoring + approval před decryptem citlivých polí.
- ML anomálie → automatická rotace/rewrap slotů.

## Stage 18 – Continuous Assurance & Certifications
- Exporty pro SOC2/ISO/NIS2 (rotace, KMS health, manifest podpisy) přímo z JS telemetry.
- Live posture dashboard: crypto hygiene score, simulace výpadků cloud KMS.
- Předpřipravené politiky pro regulated sectors, with SDK enforcement.

## Stage 19 – Federated Privacy & Clean Rooms
- Standardizované tokens/envelopes pro clean-room výpočty a federované AI tréninky.
- SMPC/FHE experimenty pro agregace (count/sum/CTR) řízené politikami (cost/risk guardrails).
- Cross-tenant mesh: rotace, wrap queue, attestace napříč partnery bez sdílení plaintextu.

## Stage 20 – Certified PQ & Multi-Cloud Resilience
- PQ readiness kit: evidence rotací, attestation KMS/HSM, DR runbooky (multi-cloud).
- Geo-distributed policy mesh s automatickým failover/failback; no manual ops.
- Adaptive cost/risk engine volí algoritmy/route (PQC vs hybrid) dle SLA/nákladů/compliance.

## Stage 21 – Zero-Knowledge Control Plane
- ZK důkazy, že wrap/unwrap splnil politiku bez odhalení obsahu.
- ZK + attestation pro klienty v citlivých tenantech; prove-before-run režim pro export/unwrap.
- Audit feed do SIEM se ZK summary (bez leaků o datech).

## Stage 22 – Quantum Resilience Benchmark Suite
- Benchmarky + test vectors pro PQ/hybrid AEAD/HMAC sloty, publikační scorecard.
- Chaos/DR testy pro JS KMS klienty (latence, výpadky, útoky) s auto hardening doporučeními.
- Trust levels per algoritmus/route, sdílené s governance/SRE playbooky.

## Stage 23 – Policy-as-Code & Explainable Crypto
- Policy-as-code hub (OPA/rego + ZK proofs) – preview dopadů před nasazením.
- Explainable router: proč zvolená trasa/algoritmus, náklad/riziko, shadow routing pro A/B.
- Shadow režim testuje nové politiky paralelně, publikuje srovnávací metriky.

## Stage 24 – AI-Augmented Operations
- AI asistenti pro incidenty (reroute, rewrap, suspend client) s odhadovaným dopadem.
- Predictive scaling pro KMS/router (telemetry-driven) a SLA-aware load placement.
- Auto tvorba runbooků + PR do manifestů/politik na základě zjištěných anomálií.
