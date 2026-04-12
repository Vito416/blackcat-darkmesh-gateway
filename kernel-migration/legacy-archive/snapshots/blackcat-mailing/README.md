# BlackCat Mailing

Centralizovaný mailing modul pro ekosystém BlackCat:
- DB-backed outbox přes `blackcat-database` (`notifications` + views-library),
- šifrování payloadů transparentně přes `blackcat-database-crypto` ingress (pokud je nakonfigurován),
- SMTP transport (PHPMailer),
- worker pro zpracování fronty.

## Rychlý start (worker)

Worker bere konfiguraci z env:
- `BLACKCAT_DB_DSN`, `BLACKCAT_DB_USER`, `BLACKCAT_DB_PASS`
- `BLACKCAT_MAILING_SMTP_HOST`, `BLACKCAT_MAILING_SMTP_PORT`
- `BLACKCAT_MAILING_SMTP_USER`, `BLACKCAT_MAILING_SMTP_PASS` (volitelné)
- `BLACKCAT_MAILING_SMTP_ENCRYPTION` (`tls`/`ssl`/empty)
- `BLACKCAT_MAILING_FROM_EMAIL`, `BLACKCAT_MAILING_FROM_NAME`

```bash
php bin/mailing-worker
```

## Integrace (enqueue)

Mailing zapisuje e-maily jako notifikace do tabulky `notifications`:
- `channel=email`
- `template` (např. `verify_email`, renderuje se z `templates/email/verify_email.php`)
- `payload` je JSON (může být šifrovaný ingress adaptérem)

Payload konvence pro e-mail:
```json
{
  "to_email": "user@example.com",
  "to_name": null,
  "vars": { "verify_url": "https://app.example.com/verify?token=...", "app_name": "BlackCat", "ttl_seconds": 86400 }
}
```

Šablony:
- `verify_email` očekává `vars.verify_url`, `vars.app_name`, `vars.ttl_seconds`
- `reset_password` očekává `vars.reset_url`, `vars.app_name`, `vars.ttl_seconds` (a volitelně `vars.token`)
- `magic_link` očekává `vars.magic_link_url`, `vars.app_name`, `vars.ttl_seconds` (a volitelně `vars.token`)

Poznámka: `notifications.tenant_id` je povinné (FK na `tenants`). Pro single-tenant setup je nejjednodušší použít `SlugTenantResolver` s `autoCreate=true`.

Detailní postup integrace je popsán v `docs/ROADMAP.md` a bude doplněn do integračních příkladů v dalších repozitářích (např. `blackcat-auth`).

## Core kompatibilita

Pokud v projektu stále používáš `BlackCat\\Core\\Mail\\Mailer`, stačí nainstalovat `blackcat-mailing` – `blackcat-core` má shim, který automaticky deleguje do `BlackCat\\Mailing\\CoreCompat\\CoreMailer`.

## Licensing

This repository is an official component of the Blackcat Covered System. It is licensed under `BFNL-1.0`, and repository separation inside `BLACKCAT_MESH_NEXUS` exists for maintenance, safety, auditability, delivery, and architectural clarity. It does not by itself create a separate unavoidable founder-fee or steward/development-fee event for the same ordinary covered deployment.

Canonical licensing bundle:
- BFNL 1.0: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/BFNL-1.0.md
- Founder Fee Policy: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/FEE_POLICY.md
- Covered-System Notice: https://github.com/Vito416/blackcat-darkmesh-ao/blob/main/docs/LICENSING_SYSTEM_NOTICE.md
