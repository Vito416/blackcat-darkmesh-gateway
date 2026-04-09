# blackcat-crypto-manifests – Roadmap

## Stage 1 – Foundations ✅
- Repo obsahuje canonical JSON manifesty (`contexts/*.json`) sdílené napříč `blackcat-crypto`, `blackcat-core`, `blackcat-crypto-js`.
- Základní README + příklady kontextů (core, payments, email).

## Stage 2 – Policy Coverage (in progress)
- Validace proti `vault:report` / `db-crypto-plan` (CI hlásí nepoužité nebo chybějící kontexty).
- CLI `manifest:lens` (v `blackcat-crypto`) exportuje manifest → graf/diagram pro governance.
- Automatické generování changelogů + semver tagging manifestů.

## Next TODO (darkmesh gateway/web)
- Publish `contexts/darkmesh-core.json` with slots for envelopes/HMAC used by gateway + worker + browser (e.g., `core.crypto.default`, `core.hmac.cache`, `core.hmac.csrf`).
- Add hash export script for Arweave publish; include sample manifest txid in gateway/web docs.
- CI check: ensure manifests used by darkmesh repos are referenced/pinned (fail if missing slots or lengths).
- Provide minimal JSON schema for envelopes to keep AO/write/gateway/worker consistent.

## Stage 3 – Multi-repo Distribution
- Publish manifest balíčky jako npm/composer artefakty (SDK + backendy dostanou pinned verze).
- `manifest:diff` CLI – zvýrazní změny mezi verzemi + generuje návrh PR do závislých repozitářů.
- Git hooks pro validaci struktury (JSON schema, required metadata, rotation hints).

## Stage 4 – Dynamic Context Negotiation
- Manifesty podporují „profiles“ (per tenant/region) + expresivní pravidla (`when`, `fallback`).
- Integrace s `blackcat-governance` pro approval workflows (PR musí projít review policy).
- Automatic rollouts: `manifest rollout plan` generuje seznam rewrap/migrate kroků pro dotčené kontexty.

## Stage 5 – AI-assisted Authoring
- Manifest editor s AI návrhy (povinné sloty podle typu dat/schémy).
- Telemetry feedback: reálná využitelnost kontextů ke zlepšení doporučení.
- Self-service API pro partnery – mohou si „pronajmout“ manifest profil (sandbox -> prod) se schválením governance.

## Stage 6 – Compliance Mesh
- Povinné podpisy manifestů, evidence o review/governance (SOC2/ISO/NIS2 export).
- CI linty proti `blackcat-governance` politikám, auto-fix návrhy.
- Manifest coverage report (kontext vs. skutečné klíče/sloty v telemetrii).

## Stage 7 – Profiles & Overrides
- „Profiles“ per tenant/region s pravidly (`when/fallback`) a life-cycle stavy (draft/pilot/prod).
- Automatic rollout plans: generuje rewrap/migrate kroky pro dotčené kontexty a publikuje do KMS/SDK.

## Stage 8 – Multi-channel Distribution
- Publikace jako npm/composer/rust crates; signed index s verzováním a BOM.
- Web katalog s vyhledáváním, diff náhledem a „try it“ scénáři proti sandbox KMS.

## Stage 9 – Telemetry-driven Evolution
- Backfeed z `vault:report`/KMS/SDK telemetry – detekce nevyužitých/duplicitních kontextů.
- AI návrhy refaktorů (sloučení/rozštěpení) + auto-generované PR do závislých repo.

## Stage 10 – Governance Workflows
- Approval workflows (policy as code) – kdo může měnit které kontexty, SLA na review.
- Audit feed (signed) pro SIEM/forenzní nástroje, integrace s `blackcat-observability`.

## Stage 11 – Partner & Marketplace Enablement
- Self-service partner manifesty (lease, review, automated sandbox→prod promotion).
- Marketplace pluginy (pre-built kontexty pro odvětví), telemetry revenue share do payout.

## Stage 12 – Clean-room Ready
- Kontexty pro federované výpočty/clean rooms (tokenization rules, masking, HE/SMPC hints).
- Risk/cost guardrails v manifestu (povolené algoritmy, geo, runtime attestation).

## Stage 13 – Shadow Policies & A/B
- Shadow manifesty: test nových politik paralelně, sběr metrik a auto-rollback.
- Explain diffs: human-readable a machine-diff (JSON patch) s dopadem na KMS/SDK/DB.

## Stage 14 – Attestation & Proof Bundles
- Attested release artefakty (sign + Merkle) pro každou verzi manifestu, publikace hashů.
- ZK-friendly struktury pro budoucí prokazování plnění politik bez leaků obsahu.

## Stage 15 – Cross-Ecosystem Mesh
- Distribuční hub pro `blackcat-crypto`, JS, Rust, DB-crypto: jednotné verze, kompatibility matice.
- Auto-sync do `blackcat-governance`, `blackcat-observability`, `blackcat-security` pro unified posture.

## Stage 16 – Automated Rollouts & Runbooks
- Generátor runbooků (per change) pro KMS/SDK/DB – rewrap order, blast-radius, fallback.
- CI guardrails: block merge pokud chybí rollout plán, test vectors, nebo podpis.

## Stage 17 – Sector Blueprints
- Předpřipravené manifest balíčky pro fin/health/public; šablony reportů (GDPR/PCI/HIPAA).
- Data-class tagging a mapování na data katalogy, automatické linty proti PII klasifikaci.

## Stage 18 – Live Posture & Scorecards
- Manifest hygiene score, drift detekce vs. produkční telemetry, doporučení k hardeningu.
- Public/partner-facing scorecard (pokud povoleno) pro důvěryhodnost crypto konfigurací.

## Stage 19 – Federated Privacy & Negotiation
- Policy negotiation mezi partnery (allowed algos/geo/attestation) bez sdílení plaintextu.
- SMPC/FHE hints v manifestu pro federované AI; audit nad negotiated policy.

## Stage 20 – Certified PQ & Resilience
- PQ readiness checklists, test vectors, certifikační balíček pro audit; geo-failover plány.
- Policy mesh pro multi-cloud: požadavky na KMS/HSM attestace, disaster toggles.

## Stage 21 – ZK Policy Proofs
- ZK proofy, že manifest změna splňuje governance pravidla bez odhalení obsahu.
- ZK-ready diff artefakty pro high-security tenanty.

## Stage 22 – AI Co-Pilot for Authors
- AI copilot, který navrhne kontexty, rotace, risk score; generuje PR s rollout plánem.
- Příklady + kódové snippet feedy podle adopce, sledování úspěšnosti doporučení.

## Stage 23 – Cost/Risk Optimizer
- Optimalizace podle nákladů/latence: doporučené algoritmy a routy pro konkrétní SLA/region.
- Simulation mode: odhady rewrap/migrate nákladů před merge.

## Stage 24 – Autonomous Policy Mesh
- Full autopilot pro nízkorizikové změny: AI + governance + telemetry → auto-merge s důkazy.
- Self-healing: detekce driftu → rollout fix + audit podpis bez manuálního zásahu.
