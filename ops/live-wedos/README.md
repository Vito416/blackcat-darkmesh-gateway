# Live WEDOS Handoff Folder

Use this folder as the canonical handoff checklist when you prepare a fresh WEDOS deployment target.

## Intended remote layout

This project expects a clean deploy directory (example):

```text
/www/
  gateway/
    dist/
    config/
    ops/
    logs/
    tmp/
```

Quick scaffold helper:

```bash
bash ops/live-wedos/init-layout.sh /www/gateway
```

## Minimal files to upload before first boot

- `dist/` from `npm run build`
- `config/example.env` copied to `config/.env` (filled with production values)
- `config/template-backend-contract.json`
- `config/template-worker-routing.example.json` -> production routing map
- `config/template-worker-token-map.example.json` -> production token map
- `config/template-worker-signature-ref-map.example.json` -> production signer map
- `config/template-variant-map.example.json` -> production variant map (site -> variant + tx ids)

## Pre-live checks after upload

Run in remote shell:

```bash
npm run ops:check-template-worker-map-coherence -- --strict --json
npm run ops:check-template-signature-ref-map -- --strict --json
npm run ops:check-template-variant-map -- --strict --json
npm run ops:check-production-readiness -- --json
```

If all checks are green, continue with release drill and final GO/NO-GO signoff.
