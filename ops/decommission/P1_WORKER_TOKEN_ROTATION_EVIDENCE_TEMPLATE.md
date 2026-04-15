# Worker Token Rotation Drill Evidence (Template)

- Date:
- Environment:
- Operator:
- Worker revision:
- Strict mode: `WORKER_STRICT_TOKEN_SCOPES=1` (yes/no)

## Rotated secrets

- `WORKER_READ_TOKEN` rotated: yes/no
- `WORKER_FORGET_TOKEN` rotated: yes/no
- `WORKER_NOTIFY_TOKEN` rotated: yes/no
- `WORKER_SIGN_TOKEN` rotated: yes/no
- Uniqueness check passed: yes/no

## Verification transcript

- Read endpoint check:
- Forget endpoint check:
- Notify endpoint check:
- Sign endpoint check:

Expected: correct token succeeds, wrong token returns `401`.

## Rollback section

- Rollback executed: yes/no
- If yes, reason:
- Post-rollback verification:

## Artifacts

- Link to command log:
- Link to CI/test run:
- Link to worker deploy output:
