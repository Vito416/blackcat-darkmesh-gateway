# Tailscale SSH Policy Snippet (free-plan safe)

Goal: keep Tailscale SSH operational while preventing routine `root@` access.

Apply in Tailscale admin ACL policy (tailnet policy file).

## Recommended model

- normal operations only as `adminops`
- optional emergency `root` access, but without paid-only fields

## Example (adapt identities to your tailnet)

```json
{
  "groups": {
    "group:ops-admins": ["Vito416@github"]
  },
  "tagOwners": {
    "tag:darkmesh-vps": ["group:ops-admins"]
  },
  "ssh": [
    {
      "action": "accept",
      "src": ["group:ops-admins"],
      "dst": ["tag:darkmesh-vps"],
      "users": ["adminops"]
    },
    {
      "action": "check",
      "src": ["group:ops-admins"],
      "dst": ["tag:darkmesh-vps"],
      "users": ["root"]
    }
  ]
}
```

## Notes

- `checkPeriod` is not used here because it is not available on all plans.
- If you do not need emergency root via Tailscale, remove the second rule entirely.
- Keep OpenSSH locked down (`PermitRootLogin no`) for defense in depth.
- Test policy changes with an already-open admin session before saving.
