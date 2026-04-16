# AO Read Fallback Chaos Probe

- Checked: 2026-04-15T16:37:41.960Z
- Status: pending
- Site: site-alpha
- Resolve path: /
- Page slug: home
- Dryrun base: https://blackcat-inbox-production.vitek-pasek.workers.dev
- Scheduler base: https://blackcat-inbox-production.vitek-pasek.workers.dev

## Probe matrix

| Profile | Action | Status | Transport mode | Parse OK |
| --- | --- | --- | --- | --- |
| dryrun | ResolveRoute | 404 | n/a | yes |
| dryrun | GetPage | 404 | n/a | yes |
| scheduler | ResolveRoute | 404 | n/a | yes |
| scheduler | GetPage | 404 | n/a | yes |

## Warnings

- dryrun profile did not expose transport.mode=dryrun (run AO adapter with debug transport visibility)
- scheduler profile did not expose transport.mode=scheduler/scheduler-direct (run AO adapter with fallback enabled + debug transport visibility)
