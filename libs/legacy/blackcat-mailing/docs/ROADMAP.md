# BlackCat Mailing – Roadmap

## Stage 1 – Queue + SMTP ✅
- DB-backed queue přes `blackcat-database` package `notifications`.
- Worker (`bin/mailing-worker`) zpracuje claimable e-maily přes `vw_notifications_due` (pending + stale `processing`) a odešle přes SMTP (PHPMailer).
- Payload encryption: pokud je aktivní `blackcat-database-crypto` ingress, `notifications.payload` se automaticky ukládá šifrovaně.

## Stage 2 – Templates & Channels (planned)
- Template registry (file-based) + fallback na “raw payload” e-maily.
- Další kanály (`push`, webhook, SMS) nad stejnou tabulkou.

## Stage 3 – Observability (planned)
- Prometheus metriky: queue depth, due_now, processing latency, send failures.
- DLQ workflow: `failed` terminal + admin tooling.
