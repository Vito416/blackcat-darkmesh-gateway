# Backup Provider Quickstart

Use this to activate encrypted restic backups on the VPS.

## 1) Generate a strong restic password

Run on VPS:

```bash
openssl rand -base64 48
```

Save it to your password manager/offline notes.

## 2) Fill `/etc/darkmesh/backup.env`

If file does not exist, create it from template:

```bash
sudo install -m 0600 /etc/darkmesh/backup.env.example /etc/darkmesh/backup.env
```

Then edit:

```bash
sudo nano /etc/darkmesh/backup.env
```

Template source is tracked in git:
- `ops/live-vps/runtime/etc/darkmesh/backup.env.example`

## 3) Fill one provider profile

### Option A (recommended): Backblaze B2

```bash
RESTIC_REPOSITORY=b2:<bucket-name>:<path-prefix>
RESTIC_PASSWORD=<your-generated-password>
RESTIC_HOST=darkmesh-vps
B2_ACCOUNT_ID=<b2-account-id>
B2_ACCOUNT_KEY=<b2-application-key>
```

### Option B: AWS S3

```bash
RESTIC_REPOSITORY=s3:s3.amazonaws.com/<bucket-name>/<path-prefix>
RESTIC_PASSWORD=<your-generated-password>
RESTIC_HOST=darkmesh-vps
AWS_ACCESS_KEY_ID=<aws-access-key-id>
AWS_SECRET_ACCESS_KEY=<aws-secret-access-key>
AWS_DEFAULT_REGION=eu-central-1
```

## 4) Validate backup manually (first run)

```bash
sudo /usr/local/sbin/darkmesh-backup.sh
```

Expected:
- restic repo initialized (first run),
- snapshot created,
- forget/prune executed,
- check passes.

If it fails with `RESTIC_REPOSITORY is required` or `RESTIC_PASSWORD is required`, finish step 2 (fill `/etc/darkmesh/backup.env`) first.

## 5) Enable scheduled backups

```bash
sudo systemctl enable --now darkmesh-backup.timer
sudo systemctl status darkmesh-backup.timer --no-pager
```

## 6) Verify logs

```bash
sudo journalctl -u darkmesh-backup.service -n 120 --no-pager
```

## Security notes

- Keep `/etc/darkmesh/backup.env` at `0600` root-only.
- Online backup profile excludes key material by design.
- Keys remain offline escrow only (see `ops/live-vps/GIT_RESTORE_MATRIX.md`).
