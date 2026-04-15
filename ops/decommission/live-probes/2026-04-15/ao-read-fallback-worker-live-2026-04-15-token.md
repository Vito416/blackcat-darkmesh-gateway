# AO Read Fallback Chaos Probe

- Checked: 2026-04-15T16:36:52.247Z
- Status: fail
- Site: site-alpha
- Resolve path: /
- Page slug: home
- Dryrun base: https://blackcat-inbox-production.vitek-pasek.workers.dev
- Scheduler base: https://blackcat-inbox-production.vitek-pasek.workers.dev

## Probe matrix

| Profile | Action | Status | Transport mode | Parse OK |
| --- | --- | --- | --- | --- |
| dryrun | ResolveRoute | 0 | n/a | no |
| dryrun | GetPage | 0 | n/a | no |
| scheduler | ResolveRoute | 404 | n/a | yes |
| scheduler | GetPage | 0 | n/a | no |

## Issues

- [dryrun/ResolveRoute] request failed: This operation was aborted
- [dryrun/GetPage] request failed: This operation was aborted
- [scheduler/GetPage] request failed: This operation was aborted

## Warnings

- dryrun profile did not expose transport.mode=dryrun (run AO adapter with debug transport visibility)
- scheduler profile did not expose transport.mode=scheduler/scheduler-direct (run AO adapter with fallback enabled + debug transport visibility)
