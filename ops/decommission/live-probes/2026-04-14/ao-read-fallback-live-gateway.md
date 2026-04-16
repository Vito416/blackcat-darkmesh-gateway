# AO Read Fallback Chaos Probe

- Checked: 2026-04-14T08:43:39.246Z
- Status: fail
- Site: site-alpha
- Resolve path: /
- Page slug: home
- Dryrun base: https://gateway.blgateway.fun
- Scheduler base: https://gateway.blgateway.fun

## Probe matrix

| Profile | Action | Status | Transport mode | Parse OK |
| --- | --- | --- | --- | --- |
| dryrun | ResolveRoute | 200 | n/a | no |
| dryrun | GetPage | 200 | n/a | no |
| scheduler | ResolveRoute | 200 | n/a | no |
| scheduler | GetPage | 200 | n/a | no |

## Issues

- [dryrun/ResolveRoute] response is not valid JSON
- [dryrun/GetPage] response is not valid JSON
- [scheduler/ResolveRoute] response is not valid JSON
- [scheduler/GetPage] response is not valid JSON

## Warnings

- dryrun profile did not expose transport.mode=dryrun (run AO adapter with debug transport visibility)
- scheduler profile did not expose transport.mode=scheduler/scheduler-direct (run AO adapter with fallback enabled + debug transport visibility)
