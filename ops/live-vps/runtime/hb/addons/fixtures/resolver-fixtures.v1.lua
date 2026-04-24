return {
  {
    name = "baseline_off_unmapped_allow",
    steps = {
      {
        msg = {
          Action = "ResolveHostForNode",
          Host = "unknown-example.fun",
          ["Request-Id"] = "rid-baseline-1",
        },
        expect = {
          ["status"] = "OK",
          ["payload.decision"] = "allow",
          ["payload.reasonCode"] = "ALLOW_HOST_UNMAPPED_MODE_OFF",
        },
      },
    },
  },
  {
    name = "soft_unmapped_fail_closed_denies",
    steps = {
      {
        msg = {
          Action = "ApplyPolicyBundle",
          ["Actor-Role"] = "admin",
          ["Policy-Mode"] = "soft",
          ["Fail-Open"] = "false",
        },
        expect = {
          ["status"] = "OK",
          ["payload.policyMode"] = "soft",
          ["payload.failOpen"] = false,
        },
      },
      {
        msg = {
          Action = "ResolveHostForNode",
          Host = "unknown-example.fun",
          ["Request-Id"] = "rid-soft-1",
        },
        expect = {
          ["status"] = "OK",
          ["payload.decision"] = "deny",
          ["payload.reasonCode"] = "DENY_READY_HOST_UNMAPPED",
        },
      },
    },
  },
  {
    name = "apply_bundle_requires_process_mapping",
    steps = {
      {
        msg = {
          Action = "ApplyPolicyBundle",
          ["Actor-Role"] = "admin",
          ["Policy-Mode"] = "off",
          ["Fail-Open"] = "true",
          Bundle = {
            hostPolicies = {
              ["jdwt.fun"] = {
                siteId = "site-jdwt",
              },
            },
          },
        },
        expect = {
          ["status"] = "ERROR",
          ["code"] = "INVALID_INPUT",
          ["message"] = "missing_process_mapping:hostPolicies.jdwt.fun",
        },
      },
    },
  },
  {
    name = "unchecked_proof_denied_in_soft_mode",
    steps = {
      {
        msg = {
          Action = "ApplyPolicyBundle",
          ["Actor-Role"] = "admin",
          ["Policy-Mode"] = "soft",
          ["Fail-Open"] = "false",
          Bundle = {
            hostPolicies = {
              ["jdwt.fun"] = {
                siteId = "site-jdwt",
              },
            },
            sitePolicies = {
              ["site-jdwt"] = {
                processId = "xIxP6d9N_B6Lr9nI6ddUJPv7wm5xkA9aHf1_l6R2q8Q",
                moduleId = "TrNj8CSFaevoYSAsnxuQ97SkdDuPvpkgxR-L6i3QCzY",
                scheduler = "_wCF37G9t-xfJuYZqc6JXI9VrG4dzM5WUFgDfOn9LdM",
                routePrefix = "/",
              },
            },
            dnsProofState = {
              ["jdwt.fun"] = {
                state = "unchecked",
                checkedAt = "2026-04-24T08:00:00Z",
                source = "fixture",
              },
            },
          },
        },
        expect = {
          ["status"] = "OK",
        },
      },
      {
        msg = {
          Action = "ResolveHostForNode",
          Host = "jdwt.fun",
          ["Request-Id"] = "rid-proof-1",
        },
        expect = {
          ["status"] = "OK",
          ["payload.decision"] = "deny",
          ["payload.reasonCode"] = "DENY_READY_DNS_PROOF_UNCHECKED",
        },
      },
    },
  },
  {
    name = "idempotency_key_includes_path_method",
    steps = {
      {
        msg = {
          Action = "ApplyPolicyBundle",
          ["Actor-Role"] = "admin",
          ["Policy-Mode"] = "off",
          ["Fail-Open"] = "true",
          Bundle = {
            hostPolicies = {
              ["jdwt.fun"] = {
                siteId = "site-jdwt",
              },
            },
            sitePolicies = {
              ["site-jdwt"] = {
                processId = "xIxP6d9N_B6Lr9nI6ddUJPv7wm5xkA9aHf1_l6R2q8Q",
                moduleId = "TrNj8CSFaevoYSAsnxuQ97SkdDuPvpkgxR-L6i3QCzY",
                scheduler = "_wCF37G9t-xfJuYZqc6JXI9VrG4dzM5WUFgDfOn9LdM",
                routePrefix = "/",
              },
            },
            dnsProofState = {
              ["jdwt.fun"] = {
                state = "valid",
                checkedAt = "2026-04-24T08:00:00Z",
                validUntil = "2026-04-24T09:00:00Z",
                source = "fixture",
              },
            },
            routePolicies = {
              ["jdwt.fun"] = {
                rules = {
                  {
                    pathPrefix = "/api",
                    methods = { "GET", "HEAD" },
                    actionHint = "read",
                  },
                },
              },
            },
          },
        },
        expect = {
          ["status"] = "OK",
        },
      },
      {
        msg = {
          Action = "ResolveRouteForHost",
          Host = "jdwt.fun",
          Path = "/api/items",
          Method = "GET",
          ["Request-Id"] = "rid-route-shared",
        },
        expect = {
          ["status"] = "OK",
          ["payload.routeHint.actionHint"] = "read",
        },
      },
      {
        msg = {
          Action = "ResolveRouteForHost",
          Host = "jdwt.fun",
          Path = "/checkout",
          Method = "POST",
          ["Request-Id"] = "rid-route-shared",
        },
        expect = {
          ["status"] = "OK",
          ["payload.routeHint.actionHint"] = "write",
        },
      },
    },
  },
  {
    name = "missing_request_id_no_replay_collision",
    steps = {
      {
        msg = {
          Action = "ApplyPolicyBundle",
          ["Actor-Role"] = "admin",
          ["Policy-Mode"] = "off",
          ["Fail-Open"] = "true",
          Bundle = {
            hostPolicies = {
              ["jdwt.fun"] = {
                siteId = "site-jdwt",
              },
            },
            sitePolicies = {
              ["site-jdwt"] = {
                processId = "xIxP6d9N_B6Lr9nI6ddUJPv7wm5xkA9aHf1_l6R2q8Q",
                moduleId = "TrNj8CSFaevoYSAsnxuQ97SkdDuPvpkgxR-L6i3QCzY",
                scheduler = "_wCF37G9t-xfJuYZqc6JXI9VrG4dzM5WUFgDfOn9LdM",
                routePrefix = "/",
              },
            },
            dnsProofState = {
              ["jdwt.fun"] = {
                state = "valid",
                checkedAt = "2026-04-24T08:00:00Z",
                validUntil = "2026-04-24T09:00:00Z",
                source = "fixture",
              },
            },
            routePolicies = {
              ["jdwt.fun"] = {
                rules = {
                  {
                    pathPrefix = "/api",
                    methods = { "GET", "HEAD" },
                    actionHint = "read",
                  },
                },
              },
            },
          },
        },
        expect = {
          ["status"] = "OK",
        },
      },
      {
        msg = {
          Action = "ResolveRouteForHost",
          Host = "jdwt.fun",
          Path = "/checkout",
          Method = "POST",
        },
        expect = {
          ["status"] = "OK",
          ["payload.routeHint.actionHint"] = "write",
        },
      },
      {
        msg = {
          Action = "ResolveRouteForHost",
          Host = "jdwt.fun",
          Path = "/api/items",
          Method = "GET",
        },
        expect = {
          ["status"] = "OK",
          ["payload.routeHint.actionHint"] = "read",
        },
      },
    },
  },
  {
    name = "cache_hint_range_validation",
    steps = {
      {
        msg = {
          Action = "ApplyPolicyBundle",
          ["Actor-Role"] = "admin",
          ["Policy-Mode"] = "off",
          ["Fail-Open"] = "true",
          ["Cache-Hints"] = {
            negativeTtlSec = 0,
          },
        },
        expect = {
          ["status"] = "ERROR",
          ["code"] = "INVALID_INPUT",
          ["message"] = "invalid_range:negativeTtlSec",
        },
      },
    },
  },
  {
    name = "cache_hint_relation_validation",
    steps = {
      {
        msg = {
          Action = "ApplyPolicyBundle",
          ["Actor-Role"] = "admin",
          ["Policy-Mode"] = "off",
          ["Fail-Open"] = "true",
          ["Cache-Hints"] = {
            staleWhileRevalidateSec = 120,
            hardMaxStaleSec = 60,
          },
        },
        expect = {
          ["status"] = "ERROR",
          ["code"] = "INVALID_INPUT",
          ["message"] = "invalid_relation:hardMaxStaleSec",
        },
      },
    },
  },
}
