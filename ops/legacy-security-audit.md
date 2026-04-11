# Legacy Security Audit

Use `scripts/audit-legacy-risk.js` to quickly triage `libs/legacy` before moving modules into the runtime path.

## What it catches

- JavaScript / TypeScript risk patterns:
  - `eval()` and `new Function()`
  - `child_process` execution calls such as `exec`, `spawn`, `execFile`, and shell-enabled execution
  - direct `process.env.*` reads that look like secrets, tokens, keys, or passwords
- PHP risk patterns:
  - `eval`, `exec`, `system`, `shell_exec`, `passthru`, `proc_open`, and `popen`
  - `include` / `require` calls that use a variable path
- Generic risk hints:
  - hardcoded private key blocks
  - bearer-token-looking strings
  - simple SQL injection anti-pattern hints where SQL text is concatenated with values

## What it does not catch

- It is a heuristic scan, not a parser or SAST tool.
- It does not prove exploitability, reachability, or data flow.
- It does not inspect runtime behavior, authorization logic, or missing escaping outside the scanned line.
- It may miss multi-line constructs, indirect wrappers, or obfuscated code.

## How to run it

From `blackcat-darkmesh-gateway/`:

```bash
node scripts/audit-legacy-risk.js
node scripts/audit-legacy-risk.js --dir libs/legacy --strict
node scripts/audit-legacy-risk.js --dir libs/legacy --json > /tmp/legacy-risk.json
```

Options:

- `--dir <path>`: directory to scan, default `libs/legacy`
- `--json`: emit structured JSON only
- `--strict`: exit `3` when critical findings exist
- `--help`: show usage

Exit codes:

- `0` when no critical findings are present, or when running non-strict
- `3` when strict mode finds critical issues, or when the scan hits a runtime/data error
- `64` for usage errors

## How to triage findings before porting

1. Start with `critical` findings and review the exact file and line.
2. Decide whether the behavior is:
   - genuinely needed in runtime,
   - a dead path that can be removed, or
   - a candidate for refactor before porting.
3. For `child_process` and PHP execution calls, confirm the input source and whether the call can be replaced with a safer library API.
4. For secret-like `process.env` reads, confirm the variable name and make sure the secret is not committed in code or config.
5. For SQL hints, check whether the query is parameterized elsewhere; if not, port it only after adding parameterization.
6. If a line is a deliberate false positive, add `audit: allow-risk` or `legacy-risk: ignore` on that line so future runs stay focused.

Tip: keep the audit output next to the migration checklist so every module gets reviewed before runtime import.
