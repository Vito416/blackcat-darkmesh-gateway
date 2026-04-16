# Live strict drill (allow-anon) - 2026-04-15

Command:

```bash
bash scripts/run-live-strict-drill.sh --allow-anon --skip-forget-forward
```

Inputs:
- `CONSISTENCY_URLS=https://gateway.blgateway.fun,https://gateway.blgateway.fun`
- template worker/signature/variant maps loaded from latest drill artifacts
- `REQUIRED_TEMPLATE_SITES=site-alpha`

Result:
- preflight checks passed (`validate-template-backend-contract`, worker map checks, variant map check, consistency preflight)
- release drill failed on step `compare-integrity-matrix`
- observed response: `HTTP 401 Unauthorized` from `/integrity/state`
- matrix outcome: `failure=1`, exit code `2` (propagated by release drill as non-zero)

Interpretation:
- `--allow-anon` flow is now wired end-to-end in tooling, but live gateway currently requires `GATEWAY_INTEGRITY_STATE_TOKEN`.
- To close P1-05/P1-06 on live strict path, provide the state token (or intentionally switch gateway state endpoint to public mode).
