-- Resolver process scaffold: host -> decision contract for HB policy routing.
-- This v1 intentionally fails open and defaults to mode=off.
-- Source snapshot: ../blackcat-darkmesh-ao/ao/resolver/process.lua (copied 2026-04-24).

local codec = require "ao.shared.codec"
local validation = require "ao.shared.validation"
local auth = require "ao.shared.auth"
local idem = require "ao.shared.idempotency"
local metrics = require "ao.shared.metrics"
local persist = require "ao.shared.persist"

local handlers = {}
local map_count
local allowed_actions = {
  "ResolveHostForNode",
  "ResolveRouteForHost",
  "GetResolverState",
  "ApplyPolicyBundle",
  "InvalidateResolverCache",
  "GetResolverCacheStats",
}

local public_read_actions = {
  ResolveHostForNode = true,
  ResolveRouteForHost = true,
  GetResolverState = true, -- safe summary only
  GetResolverCacheStats = true, -- safe summary only
}

local role_policy = {
  ApplyPolicyBundle = { "admin", "registry-admin" },
  InvalidateResolverCache = { "admin", "registry-admin" },
}

local hmac_skip_actions = {
  ResolveHostForNode = true,
  ResolveRouteForHost = true,
  GetResolverState = true,
  GetResolverCacheStats = true,
}

local VALID_POLICY_MODES = {
  off = true,
  observe = true,
  soft = true,
  enforce = true,
}

local PUBLIC_READ_REQUIRE_AUTH = (os.getenv "RESOLVER_PUBLIC_READ_REQUIRE_AUTH" or "0") == "1"
local MAX_HOST_BYTES = tonumber(os.getenv "RESOLVER_MAX_HOST_BYTES" or "") or 253
local MAX_PATH_BYTES = tonumber(os.getenv "RESOLVER_MAX_PATH_BYTES" or "") or 2048
local MAX_METHOD_BYTES = tonumber(os.getenv "RESOLVER_MAX_METHOD_BYTES" or "") or 16
local RESOLUTION_CACHE_MAX_ENTRIES = tonumber(os.getenv "RESOLVER_CACHE_MAX_ENTRIES" or "") or 20000
local RESOLVER_PERSIST_MIN_INTERVAL_SEC = tonumber(os.getenv "RESOLVER_PERSIST_MIN_INTERVAL_SEC" or "") or 5

local mutating_actions = {
  ApplyPolicyBundle = true,
  InvalidateResolverCache = true,
}
local last_persist_epoch = 0

local state = persist.load("resolver_state", {
  policyMode = "off", -- off|observe|soft|enforce
  failOpen = true,
  cacheHints = {
    positiveTtlSec = 300,
    negativeTtlSec = 60,
    staleWhileRevalidateSec = 900,
    hardMaxStaleSec = 3600,
  },
  hostPolicies = {}, -- host -> { siteId, processId, moduleId, scheduler, routePrefix, status }
  sitePolicies = {}, -- siteId -> { processId, moduleId, scheduler, routePrefix, status }
  routePolicies = {}, -- host -> { defaultActionHint?, rules = { { pathPrefix, methods?, actionHint } } }
  dnsProofState = {}, -- host -> { state, checkedAt, validUntil, source, challengeRef }
  resolutionCache = {}, -- host -> { host, siteId?, decision, reasonCode, mode, proofState, cachedAt, expiresAt, surface }
  bundleMeta = { -- latest applied bundle metadata
    snapshotId = nil,
    version = nil,
    generatedAt = nil,
    appliedAt = nil,
  },
  cacheMeta = {
    lastInvalidatedAt = nil,
  },
  lastResolvedAt = nil,
})

local function now_iso()
  return os.date "!%Y-%m-%dT%H:%M:%SZ"
end

local function plus_seconds_iso(seconds)
  return os.date("!%Y-%m-%dT%H:%M:%SZ", os.time() + math.max(0, tonumber(seconds) or 0))
end

local function trim(text)
  if type(text) ~= "string" then
    return text
  end
  return (text:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function parse_node_id(msg)
  local node_id = msg["Node-Id"] or msg.nodeId or msg["Resolver-Id"]
  if node_id == nil then
    return nil
  end
  local ok_len, err_len = validation.check_length(node_id, 128, "Node-Id")
  if not ok_len then
    return nil, err_len
  end
  return tostring(node_id)
end

local function read_request_id(msg)
  local request_id = msg["Request-Id"] or msg.requestId
  if type(request_id) ~= "string" then
    return ""
  end
  return trim(request_id) or ""
end

local function normalize_host(raw_host, field_name)
  local field = field_name or "Host"
  if type(raw_host) ~= "string" then
    return nil, ("invalid_type:%s"):format(field)
  end

  local host = trim(raw_host)
  if host == nil or host == "" then
    return nil, ("invalid_format:%s"):format(field)
  end

  -- Host header can contain a single ":<port>" suffix; strip it.
  local name, port = host:match("^([^:]+):(%d+)$")
  if name and port then
    host = name
  end

  host = string.lower(host)
  host = host:gsub("%.$", "")

  local ok_len, err_len = validation.check_length(host, MAX_HOST_BYTES, field)
  if not ok_len then
    return nil, err_len
  end

  if host == "" or host:find("%.%.", 1, true) then
    return nil, ("invalid_format:%s"):format(field)
  end
  if host:find("[/%?#@%[%] ]") then
    return nil, ("invalid_format:%s"):format(field)
  end
  if not host:match "^[a-z0-9%.%-]+$" then
    return nil, ("invalid_format:%s"):format(field)
  end

  for label in host:gmatch("[^.]+") do
    if #label == 0 or #label > 63 then
      return nil, ("invalid_format:%s"):format(field)
    end
    if label:sub(1, 1) == "-" or label:sub(-1) == "-" then
      return nil, ("invalid_format:%s"):format(field)
    end
  end

  return host
end

local function normalize_process_identifier(raw_value, field_name)
  if raw_value == nil then
    return nil
  end
  local value = trim(tostring(raw_value)) or ""
  if value == "" then
    return nil
  end
  local ok_len, err_len = validation.check_length(value, 128, field_name)
  if not ok_len then
    return nil, err_len
  end
  if #value < 20 or not value:match "^[A-Za-z0-9_-]+$" then
    return nil, ("invalid_format:%s"):format(field_name)
  end
  return value
end

local normalize_path

local function ensure_cache_hints()
  state.cacheHints = state.cacheHints or {}
  state.cacheHints.positiveTtlSec = tonumber(state.cacheHints.positiveTtlSec) or 300
  state.cacheHints.negativeTtlSec = tonumber(state.cacheHints.negativeTtlSec) or 60
  state.cacheHints.staleWhileRevalidateSec = tonumber(state.cacheHints.staleWhileRevalidateSec) or 900
  state.cacheHints.hardMaxStaleSec = tonumber(state.cacheHints.hardMaxStaleSec) or 3600
end

local function ensure_state_defaults()
  local mode = tostring(state.policyMode or "off"):lower()
  if not VALID_POLICY_MODES[mode] then
    mode = "off"
  end
  state.policyMode = mode
  state.failOpen = state.failOpen ~= false
  if type(state.hostPolicies) ~= "table" then
    state.hostPolicies = {}
  end
  if type(state.sitePolicies) ~= "table" then
    state.sitePolicies = {}
  end
  if type(state.routePolicies) ~= "table" then
    state.routePolicies = {}
  end
  if type(state.dnsProofState) ~= "table" then
    state.dnsProofState = {}
  end
  if type(state.resolutionCache) ~= "table" then
    state.resolutionCache = {}
  end
  if type(state.bundleMeta) ~= "table" then
    state.bundleMeta = { appliedAt = nil }
  end
  if type(state.cacheMeta) ~= "table" then
    state.cacheMeta = { lastInvalidatedAt = nil }
  end
  ensure_cache_hints()
end

ensure_state_defaults()

local function normalize_mode(mode)
  local normalized = tostring(mode or state.policyMode or "off"):lower()
  if VALID_POLICY_MODES[normalized] then
    return normalized, nil
  end
  return "off", "ERROR_INVALID_POLICY_MODE_FALLBACK"
end

local function parse_fail_open(value, current_value)
  if value == nil then
    return current_value
  end
  if type(value) == "boolean" then
    return value
  end
  if type(value) == "number" then
    if value == 1 then
      return true
    end
    if value == 0 then
      return false
    end
  end
  if type(value) == "string" then
    local lower = string.lower(value)
    if lower == "1" or lower == "true" or lower == "yes" then
      return true
    end
    if lower == "0" or lower == "false" or lower == "no" then
      return false
    end
  end
  return nil, "invalid_boolean:Fail-Open"
end

local function normalize_cache_hints(input)
  if input == nil then
    return nil
  end
  if type(input) ~= "table" then
    return nil, "invalid_type:Cache-Hints"
  end
  local function parse_cache_hint_number(raw_value, hint_name, min_value, max_value)
    local value = tonumber(raw_value)
    if not value or value % 1 ~= 0 then
      return nil, ("invalid_number:%s"):format(hint_name)
    end
    if value < min_value or value > max_value then
      return nil, ("invalid_range:%s"):format(hint_name)
    end
    return value, nil
  end
  local out = {}
  if input.positiveTtlSec ~= nil then
    local parsed, parse_err = parse_cache_hint_number(input.positiveTtlSec, "positiveTtlSec", 1, 86400)
    if parse_err then
      return nil, parse_err
    end
    out.positiveTtlSec = parsed
  end
  if input.negativeTtlSec ~= nil then
    local parsed, parse_err = parse_cache_hint_number(input.negativeTtlSec, "negativeTtlSec", 1, 86400)
    if parse_err then
      return nil, parse_err
    end
    out.negativeTtlSec = parsed
  end
  if input.staleWhileRevalidateSec ~= nil then
    local parsed, parse_err =
      parse_cache_hint_number(input.staleWhileRevalidateSec, "staleWhileRevalidateSec", 0, 86400)
    if parse_err then
      return nil, parse_err
    end
    out.staleWhileRevalidateSec = parsed
  end
  if input.hardMaxStaleSec ~= nil then
    local parsed, parse_err = parse_cache_hint_number(input.hardMaxStaleSec, "hardMaxStaleSec", 0, 172800)
    if parse_err then
      return nil, parse_err
    end
    out.hardMaxStaleSec = parsed
  end
  return out
end

local function normalize_host_policies(input)
  if input == nil then
    return nil
  end
  if type(input) ~= "table" then
    return nil, "invalid_type:hostPolicies"
  end
  local out = {}
  for host_key, spec in pairs(input) do
    if type(spec) == "table" then
      local host, host_err = normalize_host(host_key, "hostPolicies")
      if not host then
        return nil, host_err
      end
      local site_id = spec.siteId or spec["Site-Id"] or spec.site_id
      if site_id == nil then
        return nil, ("missing_field:hostPolicies.siteId:%s"):format(host)
      end
      site_id = trim(tostring(site_id)) or ""
      local ok_site_len, site_len_err = validation.check_length(site_id, 128, "Site-Id")
      if not ok_site_len or site_id == "" then
        return nil, site_len_err or ("invalid_format:Site-Id:%s"):format(host)
      end

      local process_id, process_err =
        normalize_process_identifier(spec.processId or spec["Process-Id"] or spec.process_id, "Process-Id")
      if process_err then
        return nil, process_err
      end
      local module_id, module_err =
        normalize_process_identifier(spec.moduleId or spec["Module-Id"] or spec.module_id, "Module-Id")
      if module_err then
        return nil, module_err
      end
      local scheduler_id, scheduler_err =
        normalize_process_identifier(spec.scheduler or spec["Scheduler-Id"] or spec.scheduler_id, "Scheduler-Id")
      if scheduler_err then
        return nil, scheduler_err
      end

      local route_prefix = spec.routePrefix or spec["Route-Prefix"] or spec.route_prefix
      if route_prefix ~= nil then
        local normalized_route_prefix, route_prefix_err = normalize_path(tostring(route_prefix), "Route-Prefix")
        if not normalized_route_prefix then
          return nil, route_prefix_err
        end
        route_prefix = normalized_route_prefix
      end

      local status = spec.status
      if status ~= nil then
        status = trim(tostring(status)) or ""
        local ok_status_len, status_len_err = validation.check_length(status, 64, "status")
        if not ok_status_len or status == "" then
          return nil, status_len_err or ("invalid_format:status:%s"):format(host)
        end
      end
      local entry = {
        siteId = site_id,
        processId = process_id,
        moduleId = module_id,
        scheduler = scheduler_id,
        routePrefix = route_prefix,
        status = status,
      }
      out[host] = entry
    end
  end
  return out
end

local function normalize_site_policies(input)
  if input == nil then
    return nil
  end
  if type(input) ~= "table" then
    return nil, "invalid_type:sitePolicies"
  end
  local out = {}
  for site_key, spec in pairs(input) do
    if type(spec) == "table" then
      local site_id = tostring(spec.siteId or spec["Site-Id"] or spec.site_id or site_key)
      local ok_len, err_len = validation.check_length(site_id, 128, "Site-Id")
      if not ok_len or site_id == "" then
        return nil, err_len or "invalid_format:Site-Id"
      end
      local process_id, process_err =
        normalize_process_identifier(spec.processId or spec["Process-Id"] or spec.process_id, "Process-Id")
      if process_err then
        return nil, process_err
      end
      local module_id, module_err =
        normalize_process_identifier(spec.moduleId or spec["Module-Id"] or spec.module_id, "Module-Id")
      if module_err then
        return nil, module_err
      end
      local scheduler_id, scheduler_err =
        normalize_process_identifier(spec.scheduler or spec["Scheduler-Id"] or spec.scheduler_id, "Scheduler-Id")
      if scheduler_err then
        return nil, scheduler_err
      end
      local route_prefix = spec.routePrefix or spec["Route-Prefix"] or spec.route_prefix
      if route_prefix ~= nil then
        local normalized_route_prefix, route_prefix_err = normalize_path(tostring(route_prefix), "Route-Prefix")
        if not normalized_route_prefix then
          return nil, route_prefix_err
        end
        route_prefix = normalized_route_prefix
      end
      local status = spec.status
      if status ~= nil then
        status = trim(tostring(status)) or ""
        local ok_status_len, status_len_err = validation.check_length(status, 64, "status")
        if not ok_status_len or status == "" then
          return nil, status_len_err or "invalid_format:status"
        end
      end
      out[site_id] = {
        processId = process_id,
        moduleId = module_id,
        scheduler = scheduler_id,
        routePrefix = route_prefix,
        status = status,
      }
    end
  end
  return out
end

local function normalize_dns_proof_state(input)
  if input == nil then
    return nil
  end
  if type(input) ~= "table" then
    return nil, "invalid_type:dnsProofState"
  end
  local out = {}
  for host_key, spec in pairs(input) do
    if type(spec) == "table" then
      local host, host_err = normalize_host(host_key, "dnsProofState")
      if not host then
        return nil, host_err
      end
      local proof_state = tostring(spec.state or spec.dnsProofState or "unchecked"):lower()
      if proof_state ~= "valid" and proof_state ~= "expired" and proof_state ~= "missing" and proof_state ~= "unchecked" then
        proof_state = "unchecked"
      end
      out[host] = {
        state = proof_state,
        checkedAt = spec.checkedAt or spec.dnsProofCheckedAt,
        validUntil = spec.validUntil or spec.dnsProofValidUntil,
        source = spec.source,
        challengeRef = spec.challengeRef,
      }
    end
  end
  return out
end

local function normalize_method(raw_method, field_name)
  local field = field_name or "Method"
  if type(raw_method) ~= "string" then
    return nil, ("invalid_type:%s"):format(field)
  end
  local method = string.upper(trim(raw_method) or "")
  if method == "" then
    return nil, ("invalid_format:%s"):format(field)
  end
  local ok_len, err_len = validation.check_length(method, MAX_METHOD_BYTES, field)
  if not ok_len then
    return nil, err_len
  end
  if not method:match "^[A-Z]+$" then
    return nil, ("invalid_format:%s"):format(field)
  end
  return method
end

normalize_path = function(raw_path, field_name)
  local field = field_name or "Path"
  if type(raw_path) ~= "string" then
    return nil, ("invalid_type:%s"):format(field)
  end
  local path = trim(raw_path) or ""
  if path == "" then
    path = "/"
  end
  if path:sub(1, 1) ~= "/" then
    path = "/" .. path
  end
  local q_idx = path:find("?", 1, true)
  if q_idx then
    path = path:sub(1, q_idx - 1)
  end
  local h_idx = path:find("#", 1, true)
  if h_idx then
    path = path:sub(1, h_idx - 1)
  end
  if path == "" then
    path = "/"
  end
  local ok_len, err_len = validation.check_length(path, MAX_PATH_BYTES, field)
  if not ok_len then
    return nil, err_len
  end
  if path:find("%s") then
    return nil, ("invalid_format:%s"):format(field)
  end
  return path
end

local function normalize_site_id(raw_site_id, field_name)
  local field = field_name or "Site-Id"
  if type(raw_site_id) ~= "string" then
    return nil, ("invalid_type:%s"):format(field)
  end
  local site_id = trim(raw_site_id) or ""
  if site_id == "" then
    return nil, ("invalid_format:%s"):format(field)
  end
  local ok_len, err_len = validation.check_length(site_id, 128, field)
  if not ok_len then
    return nil, err_len
  end
  return site_id
end

local function normalize_method_set(input)
  if input == nil then
    return nil
  end
  if type(input) ~= "table" then
    return nil, "invalid_type:methods"
  end
  local out = {}
  for _, method in ipairs(input) do
    local normalized_method, method_err = normalize_method(method, "methods")
    if not normalized_method then
      return nil, method_err
    end
    out[normalized_method] = true
  end
  return out
end

local function normalize_route_policies(input)
  if input == nil then
    return nil
  end
  if type(input) ~= "table" then
    return nil, "invalid_type:routePolicies"
  end
  local out = {}
  for host_key, spec in pairs(input) do
    if type(spec) == "table" then
      local host, host_err = normalize_host(host_key, "routePolicies")
      if not host then
        return nil, host_err
      end
      local entry = {}
      if spec.defaultActionHint ~= nil then
        local ok_len_hint, err_len_hint =
          validation.check_length(spec.defaultActionHint, 128, "defaultActionHint")
        if not ok_len_hint then
          return nil, err_len_hint
        end
        entry.defaultActionHint = tostring(spec.defaultActionHint)
      end
      entry.rules = {}
      local rules = spec.rules or {}
      if type(rules) ~= "table" then
        return nil, "invalid_type:routePolicies.rules"
      end
      for _, rule in ipairs(rules) do
        if type(rule) == "table" then
          local prefix = rule.pathPrefix or rule.path or "/"
          local normalized_prefix, prefix_err = normalize_path(prefix, "pathPrefix")
          if not normalized_prefix then
            return nil, prefix_err
          end
          local methods, methods_err = normalize_method_set(rule.methods)
          if methods_err then
            return nil, methods_err
          end
          local action_hint = tostring(rule.actionHint or entry.defaultActionHint or "read")
          local ok_len_action, err_len_action = validation.check_length(action_hint, 128, "actionHint")
          if not ok_len_action then
            return nil, err_len_action
          end
          table.insert(entry.rules, {
            pathPrefix = normalized_prefix,
            methods = methods,
            actionHint = action_hint,
          })
        end
      end
      out[host] = entry
    end
  end
  return out
end

local function validate_policy_graph(host_policies, site_policies)
  for host, spec in pairs(host_policies or {}) do
    local site_id = spec and spec.siteId
    if type(site_id) ~= "string" or site_id == "" then
      return nil, ("missing_site_id:hostPolicies.%s"):format(host)
    end
    local site_spec = site_policies and site_policies[site_id] or nil
    local process_id = (spec and spec.processId) or (site_spec and site_spec.processId)
    if type(process_id) ~= "string" or process_id == "" then
      return nil, ("missing_process_mapping:hostPolicies.%s"):format(host)
    end
  end
  return true, nil
end

local function infer_site_process(host, host_policy)
  local site_id = host_policy and host_policy.siteId or nil
  local site_policy = site_id and state.sitePolicies[site_id] or nil

  local site_obj
  local process_obj

  if site_id then
    site_obj = {
      siteId = site_id,
      host = host,
      status = (host_policy and host_policy.status) or (site_policy and site_policy.status) or "unknown",
    }

    local process_id = (host_policy and host_policy.processId) or (site_policy and site_policy.processId)
    if process_id then
      process_obj = {
        processId = process_id,
        moduleId = (host_policy and host_policy.moduleId) or (site_policy and site_policy.moduleId),
        scheduler = (host_policy and host_policy.scheduler) or (site_policy and site_policy.scheduler),
        routePrefix = (host_policy and host_policy.routePrefix) or (site_policy and site_policy.routePrefix),
      }
    end
  end

  return site_obj, process_obj
end

local function epoch_to_iso(epoch)
  if not epoch then
    return nil
  end
  return os.date("!%Y-%m-%dT%H:%M:%SZ", epoch)
end

local function build_cache_payload(host_known, proof_payload, surface_key, cache_state, cache_window)
  ensure_cache_hints()
  local ttl = host_known and state.cacheHints.positiveTtlSec or state.cacheHints.negativeTtlSec
  local now_epoch = os.time()
  local expires_epoch = cache_window and cache_window.expiresAtEpoch or (now_epoch + ttl)
  local stale_until_epoch = cache_window and cache_window.staleUntilEpoch
    or (expires_epoch + state.cacheHints.staleWhileRevalidateSec)
  local expires_at = epoch_to_iso(expires_epoch)
  local dns_next_check_at = proof_payload.dnsProofValidUntil or epoch_to_iso(now_epoch + state.cacheHints.negativeTtlSec)
  local key_prefix = surface_key or "host"
  local state_value = cache_state or "miss"
  local stale = state_value == "stale"
  local hit = state_value == "hit" or state_value == "negative_hit" or stale
  local negative = state_value == "negative_hit"
  return {
    cacheable = true,
    key = host_known and ("resolver:" .. key_prefix .. ":hit") or ("resolver:" .. key_prefix .. ":miss"),
    cacheState = state_value,
    hit = hit,
    stale = stale,
    staleWhileRevalidate = stale,
    negative = negative,
    ttlSec = ttl,
    expiresAt = expires_at,
    staleUntilAt = epoch_to_iso(stale_until_epoch),
    revalidateAfterAt = expires_at,
    dnsNextCheckAt = dns_next_check_at,
    positiveTtlSec = state.cacheHints.positiveTtlSec,
    negativeTtlSec = state.cacheHints.negativeTtlSec,
    staleWhileRevalidateSec = state.cacheHints.staleWhileRevalidateSec,
    hardMaxStaleSec = state.cacheHints.hardMaxStaleSec,
  }
end

local function make_cache_key(surface, host, path, method, mode)
  local mode_part = mode or "off"
  if surface == "route" then
    return table.concat({ "route", mode_part, host or "", path or "/", method or "GET" }, "|")
  end
  return table.concat({ "host", mode_part, host or "" }, "|")
end

local function get_cached_resolution(cache_key)
  local entry = state.resolutionCache[cache_key]
  if not entry then
    return nil, "miss"
  end
  local now_epoch = os.time()
  if entry.expiresAtEpoch and now_epoch <= entry.expiresAtEpoch then
    if entry.negative then
      return entry, "negative_hit"
    end
    return entry, "hit"
  end
  if entry.staleUntilEpoch and now_epoch <= entry.staleUntilEpoch then
    return entry, "stale"
  end
  state.resolutionCache[cache_key] = nil
  return nil, "miss"
end

local function upsert_resolution_cache(cache_key, host, data)
  local now_epoch = os.time()
  local ttl = data.hostKnown and state.cacheHints.positiveTtlSec or state.cacheHints.negativeTtlSec
  local expires_epoch = now_epoch + ttl
  local stale_until_epoch = expires_epoch + state.cacheHints.staleWhileRevalidateSec
  state.resolutionCache[cache_key] = {
    cacheKey = cache_key,
    host = host,
    siteId = data.siteId,
    decision = data.decision,
    reasonCode = data.reasonCode,
    mode = data.mode,
    proofState = data.proofState,
    cachedAt = now_iso(),
    expiresAt = epoch_to_iso(expires_epoch),
    expiresAtEpoch = expires_epoch,
    staleUntilAt = epoch_to_iso(stale_until_epoch),
    staleUntilEpoch = stale_until_epoch,
    dnsNextCheckAt = data.dnsNextCheckAt,
    surface = data.surface,
    actionHint = data.actionHint,
    hostKnown = data.hostKnown,
    path = data.path,
    method = data.method,
    process = data.process,
    site = data.site,
    proof = data.proof,
    negative = data.hostKnown ~= true,
  }
end

local function invalidate_cache_by_host(host)
  local removed = 0
  for key, entry in pairs(state.resolutionCache) do
    if entry and entry.host == host then
      state.resolutionCache[key] = nil
      removed = removed + 1
    end
  end
  return removed
end

local function invalidate_cache_by_site(site_id)
  local removed = 0
  for host, entry in pairs(state.resolutionCache) do
    if entry and entry.siteId == site_id then
      state.resolutionCache[host] = nil
      removed = removed + 1
    end
  end
  return removed
end

local function invalidate_cache_all()
  local removed = 0
  for host, _ in pairs(state.resolutionCache) do
    state.resolutionCache[host] = nil
    removed = removed + 1
  end
  return removed
end

local function prune_resolution_cache()
  local now_epoch = os.time()
  local removed = 0
  local survivors = {}
  local remaining = 0

  for key, entry in pairs(state.resolutionCache) do
    local stale_until_epoch = entry and entry.staleUntilEpoch
    if stale_until_epoch and now_epoch > stale_until_epoch then
      state.resolutionCache[key] = nil
      removed = removed + 1
    else
      remaining = remaining + 1
      table.insert(survivors, { key = key, expiresAtEpoch = entry and entry.expiresAtEpoch or 0 })
    end
  end

  if remaining > RESOLUTION_CACHE_MAX_ENTRIES then
    table.sort(survivors, function(a, b)
      return (a.expiresAtEpoch or 0) < (b.expiresAtEpoch or 0)
    end)
    local overflow = remaining - RESOLUTION_CACHE_MAX_ENTRIES
    for i = 1, overflow do
      local victim = survivors[i]
      if victim and state.resolutionCache[victim.key] ~= nil then
        state.resolutionCache[victim.key] = nil
        removed = removed + 1
      end
    end
  end

  return removed
end

local function maybe_persist_state(force)
  local now_epoch = os.time()
  local min_interval = math.max(0, RESOLVER_PERSIST_MIN_INTERVAL_SEC)
  if force or min_interval == 0 or (now_epoch - last_persist_epoch) >= min_interval then
    persist.save("resolver_state", state)
    last_persist_epoch = now_epoch
  end
end

local function build_proof_payload(host)
  local proof = state.dnsProofState[host]
  if not proof then
    return {
      dnsProofState = "unchecked",
      dnsProofCheckedAt = nil,
      dnsProofValidUntil = nil,
      source = "resolver-cache",
    }
  end
  return {
    dnsProofState = proof.state or "unchecked",
    dnsProofCheckedAt = proof.checkedAt,
    dnsProofValidUntil = proof.validUntil,
    source = proof.source or "resolver-cache",
    challengeRef = proof.challengeRef,
  }
end

local function evaluate_dns_proof_decision(mode, host_known, proof_state)
  local decision = "allow"
  local reason

  if not host_known then
    return decision, nil
  end

  if proof_state == "valid" then
    return decision, "ALLOW_DNS_PROOF_VALID"
  end

  if proof_state == "expired" then
    if mode == "off" then
      return decision, "ALLOW_DNS_PROOF_EXPIRED_MODE_OFF"
    end
    if mode == "observe" then
      return decision, "ALLOW_DNS_PROOF_EXPIRED_MODE_OBSERVE"
    end
    reason = "DENY_READY_DNS_PROOF_EXPIRED"
  elseif proof_state == "missing" then
    if mode == "off" then
      return decision, "ALLOW_DNS_PROOF_MISSING_MODE_OFF"
    end
    if mode == "observe" then
      return decision, "ALLOW_DNS_PROOF_MISSING_MODE_OBSERVE"
    end
    reason = "DENY_READY_DNS_PROOF_MISSING"
  elseif proof_state == "unchecked" then
    if mode == "off" then
      return decision, "ALLOW_DNS_PROOF_UNCHECKED_MODE_OFF"
    end
    if mode == "observe" then
      return decision, "ALLOW_DNS_PROOF_UNCHECKED_MODE_OBSERVE"
    end
    reason = "DENY_READY_DNS_PROOF_UNCHECKED"
  else
    return decision, nil
  end

  if state.failOpen == false then
    decision = "deny"
  end
  return decision, reason
end

local function evaluate_route_decision(mode, host_known, proof_state)
  if not host_known then
    if mode == "off" then
      return "allow", "ALLOW_ROUTE_HOST_UNMAPPED_MODE_OFF"
    end
    if mode == "observe" then
      return "allow", "ALLOW_ROUTE_HOST_UNMAPPED_MODE_OBSERVE"
    end
    if state.failOpen == false then
      return "deny", "DENY_READY_ROUTE_HOST_UNMAPPED"
    end
    return "allow", "DENY_READY_ROUTE_HOST_UNMAPPED"
  end

  local decision, reason = evaluate_dns_proof_decision(mode, true, proof_state)
  if reason then
    return decision, reason
  end
  return "allow", "ALLOW_ROUTE_HOST_BOUND"
end

local function evaluate_host_decision(mode, host_known, proof_state)
  if not host_known then
    if mode == "off" then
      return "allow", "ALLOW_HOST_UNMAPPED_MODE_OFF"
    end
    if mode == "observe" then
      return "allow", "ALLOW_HOST_UNMAPPED_MODE_OBSERVE"
    end
    if state.failOpen == false then
      return "deny", "DENY_READY_HOST_UNMAPPED"
    end
    return "allow", "DENY_READY_HOST_UNMAPPED"
  end

  local decision, reason = evaluate_dns_proof_decision(mode, true, proof_state)
  if reason then
    return decision, reason
  end
  return "allow", "ALLOW_HOST_BOUND"
end

local function starts_with(text, prefix)
  return text:sub(1, #prefix) == prefix
end

local function infer_action_hint(path, method)
  if method == "GET" or method == "HEAD" then
    if starts_with(path, "/~process@1.0/")
      or starts_with(path, "/~scheduler@1.0/")
      or starts_with(path, "/~meta@1.0/")
      or starts_with(path, "/~relay@1.0/")
    then
      return "control_plane"
    end
    return "read"
  end
  if method == "OPTIONS" then
    return "preflight"
  end
  return "write"
end

local function resolve_action_hint(host, path, method, host_policy)
  local hint_source = "inferred"
  local site_id = host_policy and host_policy.siteId or nil
  local site_policy = site_id and state.sitePolicies[site_id] or nil
  local route_policy = state.routePolicies[host]

  if route_policy and type(route_policy.rules) == "table" then
    for _, rule in ipairs(route_policy.rules) do
      if starts_with(path, rule.pathPrefix) then
        local methods = rule.methods
        if methods == nil or methods[method] then
          return rule.actionHint or infer_action_hint(path, method), "route_policy_rule"
        end
      end
    end
    if route_policy.defaultActionHint then
      return route_policy.defaultActionHint, "route_policy_default"
    end
  end

  if host_policy and host_policy.actionHint then
    return tostring(host_policy.actionHint), "host_policy"
  end
  if site_policy and site_policy.defaultActionHint then
    return tostring(site_policy.defaultActionHint), "site_policy"
  end
  return infer_action_hint(path, method), hint_source
end

local function deny_ready(reason_code)
  return type(reason_code) == "string" and reason_code:match("^DENY_READY_") ~= nil
end

local function with_result_envelope(payload)
  payload.result = {
    decision = payload.decision,
    reasonCode = payload.reasonCode,
    status = payload.decision == "deny" and "DENY" or "ALLOW",
  }
  payload.reason = payload.reasonCode
  payload.policy = {
    mode = payload.mode,
    failOpen = state.failOpen ~= false,
    enforceMode = payload.mode == "enforce",
    denyReady = deny_ready(payload.reasonCode),
  }
  return payload
end

local function payload_from_cached_entry(entry, request_id, node_id, cache_state)
  local proof_payload = entry.proof
    or {
      dnsProofState = entry.proofState or "unchecked",
      dnsProofCheckedAt = nil,
      dnsProofValidUntil = nil,
      source = "resolver-cache",
    }
  local cache_window = {
    expiresAtEpoch = entry.expiresAtEpoch,
    staleUntilEpoch = entry.staleUntilEpoch,
  }
  local payload = {
    schemaVersion = "1.0",
    requestId = request_id,
    decision = entry.decision,
    reasonCode = entry.reasonCode,
    mode = entry.mode,
    host = entry.host,
    nodeId = node_id,
    cache = build_cache_payload(entry.hostKnown == true, proof_payload, entry.surface, cache_state, cache_window),
    proof = proof_payload,
  }
  if entry.path then
    payload.path = entry.path
  end
  if entry.method then
    payload.method = entry.method
  end
  if entry.site then
    payload.site = entry.site
  elseif entry.siteId then
    payload.site = { siteId = entry.siteId, host = entry.host, status = "unknown" }
  end
  if entry.process then
    payload.process = entry.process
  end
  if entry.actionHint then
    payload.routeHint = {
      actionHint = entry.actionHint,
      source = "cache",
    }
  end
  return with_result_envelope(payload)
end

function handlers.ApplyPolicyBundle(msg)
  local ok_extra, extras = validation.require_no_extras(msg, {
    "Action",
    "Request-Id",
    "Bundle",
    "bundle",
    "Policy-Mode",
    "PolicyMode",
    "Fail-Open",
    "FailOpen",
    "Cache-Hints",
    "CacheHints",
    "Actor-Role",
    "Schema-Version",
    "Signature",
    "Hmac",
    "hmac",
  })
  if not ok_extra then
    return codec.error("UNSUPPORTED_FIELD", "Unexpected fields", { unexpected = extras })
  end

  local bundle = msg.Bundle or msg.bundle
  if bundle ~= nil and type(bundle) ~= "table" then
    return codec.error("INVALID_INPUT", "Bundle must be an object", { field = "Bundle" })
  end
  bundle = bundle or {}

  local mode_source = bundle.policyMode or bundle.mode or msg["Policy-Mode"] or msg.PolicyMode
  local mode, mode_fallback_reason = normalize_mode(mode_source)
  if mode_fallback_reason and mode_source ~= nil then
    return codec.error("INVALID_INPUT", "Invalid policy mode", { field = "Policy-Mode" })
  end

  local fail_open_source = bundle.failOpen
  if fail_open_source == nil then
    fail_open_source = msg["Fail-Open"] or msg.FailOpen
  end
  local fail_open, fail_open_err = parse_fail_open(fail_open_source, state.failOpen ~= false)
  if fail_open == nil then
    return codec.error("INVALID_INPUT", fail_open_err, { field = "Fail-Open" })
  end

  local cache_hints_source = bundle.cacheHints or msg["Cache-Hints"] or msg.CacheHints
  local cache_hints_update, cache_err = normalize_cache_hints(cache_hints_source)
  if cache_err then
    return codec.error("INVALID_INPUT", cache_err, { field = "Cache-Hints" })
  end

  local host_input = bundle.hostPolicies or bundle.hosts or msg["Host-Policies"] or msg.HostPolicies
  local site_input = bundle.sitePolicies or bundle.sites or msg["Site-Policies"] or msg.SitePolicies
  local route_input = bundle.routePolicies or bundle.routes or msg["Route-Policies"] or msg.RoutePolicies
  local dns_input = bundle.dnsProofState or bundle.dnsProof or msg["DNS-Proof-State"] or msg.DnsProofState

  local normalized_hosts, hosts_err = normalize_host_policies(host_input)
  if hosts_err then
    return codec.error("INVALID_INPUT", hosts_err, { field = "hostPolicies" })
  end
  local normalized_sites, sites_err = normalize_site_policies(site_input)
  if sites_err then
    return codec.error("INVALID_INPUT", sites_err, { field = "sitePolicies" })
  end
  local normalized_dns, dns_err = normalize_dns_proof_state(dns_input)
  if dns_err then
    return codec.error("INVALID_INPUT", dns_err, { field = "dnsProofState" })
  end
  local normalized_routes, routes_err = normalize_route_policies(route_input)
  if routes_err then
    return codec.error("INVALID_INPUT", routes_err, { field = "routePolicies" })
  end

  local candidate_hosts = normalized_hosts or state.hostPolicies
  local candidate_sites = normalized_sites or state.sitePolicies
  local graph_ok, graph_err = validate_policy_graph(candidate_hosts, candidate_sites)
  if not graph_ok then
    return codec.error("INVALID_INPUT", graph_err, { field = "hostPolicies" })
  end

  if normalized_hosts ~= nil then
    state.hostPolicies = normalized_hosts
  end
  if normalized_sites ~= nil then
    state.sitePolicies = normalized_sites
  end
  if normalized_routes ~= nil then
    state.routePolicies = normalized_routes
  end
  if normalized_dns ~= nil then
    state.dnsProofState = normalized_dns
  end

  state.policyMode = mode
  state.failOpen = fail_open
  ensure_cache_hints()
  local next_cache_hints = {
    positiveTtlSec = state.cacheHints.positiveTtlSec,
    negativeTtlSec = state.cacheHints.negativeTtlSec,
    staleWhileRevalidateSec = state.cacheHints.staleWhileRevalidateSec,
    hardMaxStaleSec = state.cacheHints.hardMaxStaleSec,
  }
  if cache_hints_update then
    for key, value in pairs(cache_hints_update) do
      next_cache_hints[key] = value
    end
  end
  if next_cache_hints.hardMaxStaleSec < next_cache_hints.staleWhileRevalidateSec then
    return codec.error("INVALID_INPUT", "invalid_relation:hardMaxStaleSec", { field = "Cache-Hints" })
  end
  state.cacheHints = next_cache_hints

  local snapshot_id = bundle.snapshotId or msg["Snapshot-Id"] or msg.SnapshotId
  local version = bundle.version or msg.Version
  local generated_at = bundle.generatedAt or msg["Generated-At"] or msg.GeneratedAt

  state.bundleMeta = state.bundleMeta or {}
  state.bundleMeta.snapshotId = snapshot_id or state.bundleMeta.snapshotId
  state.bundleMeta.version = version or state.bundleMeta.version
  state.bundleMeta.generatedAt = generated_at or state.bundleMeta.generatedAt
  state.bundleMeta.appliedAt = now_iso()
  local purged_entries = invalidate_cache_all()
  state.cacheMeta.lastInvalidatedAt = state.bundleMeta.appliedAt

  return codec.ok {
    schemaVersion = "1.0",
    applied = true,
    appliedAt = state.bundleMeta.appliedAt,
    policyMode = state.policyMode,
    failOpen = state.failOpen,
    bundleMeta = state.bundleMeta,
    cacheInvalidation = {
      scope = "all",
      purgedEntries = purged_entries,
      lastInvalidatedAt = state.cacheMeta.lastInvalidatedAt,
    },
    counts = {
      hostPolicies = map_count(state.hostPolicies),
      sitePolicies = map_count(state.sitePolicies),
      routePolicies = map_count(state.routePolicies),
      dnsProofState = map_count(state.dnsProofState),
    },
    cacheHints = {
      positiveTtlSec = state.cacheHints.positiveTtlSec,
      negativeTtlSec = state.cacheHints.negativeTtlSec,
      staleWhileRevalidateSec = state.cacheHints.staleWhileRevalidateSec,
      hardMaxStaleSec = state.cacheHints.hardMaxStaleSec,
    },
  }
end

function handlers.InvalidateResolverCache(msg)
  local ok_extra, extras = validation.require_no_extras(msg, {
    "Action",
    "Request-Id",
    "Scope",
    "Host",
    "Site-Id",
    "Actor-Role",
    "Schema-Version",
    "Signature",
    "Hmac",
    "hmac",
  })
  if not ok_extra then
    return codec.error("UNSUPPORTED_FIELD", "Unexpected fields", { unexpected = extras })
  end

  local scope = string.lower(tostring(msg.Scope or "all"))
  local removed = 0
  local target = nil

  if scope == "all" then
    removed = invalidate_cache_all()
  elseif scope == "host" then
    local ok_fields, missing = validation.require_fields(msg, { "Host" })
    if not ok_fields then
      return codec.error("INVALID_INPUT", "Missing field", { missing = missing })
    end
    local host, host_err = normalize_host(msg.Host, "Host")
    if not host then
      return codec.error("INVALID_INPUT", host_err, { field = "Host" })
    end
    target = host
    removed = invalidate_cache_by_host(host)
  elseif scope == "site" then
    local ok_fields, missing = validation.require_fields(msg, { "Site-Id" })
    if not ok_fields then
      return codec.error("INVALID_INPUT", "Missing field", { missing = missing })
    end
    local site_id, site_err = normalize_site_id(msg["Site-Id"], "Site-Id")
    if not site_id then
      return codec.error("INVALID_INPUT", site_err, { field = "Site-Id" })
    end
    target = site_id
    removed = invalidate_cache_by_site(site_id)
  else
    return codec.error("INVALID_INPUT", "Invalid scope", { field = "Scope", allowed = { "all", "host", "site" } })
  end

  state.cacheMeta.lastInvalidatedAt = now_iso()

  return codec.ok {
    schemaVersion = "1.0",
    invalidated = true,
    scope = scope,
    target = target,
    removedEntries = removed,
    remainingEntries = map_count(state.resolutionCache),
    lastInvalidatedAt = state.cacheMeta.lastInvalidatedAt,
  }
end

function handlers.GetResolverCacheStats(_msg)
  local mapped = 0
  local unmapped = 0
  local by_proof = {
    valid = 0,
    expired = 0,
    missing = 0,
    unchecked = 0,
    other = 0,
  }
  for _, entry in pairs(state.resolutionCache) do
    if entry and entry.siteId and entry.siteId ~= "" then
      mapped = mapped + 1
    else
      unmapped = unmapped + 1
    end
    local proof_state = (entry and entry.proofState) or "unchecked"
    if by_proof[proof_state] ~= nil then
      by_proof[proof_state] = by_proof[proof_state] + 1
    else
      by_proof.other = by_proof.other + 1
    end
  end

  return codec.ok {
    schemaVersion = "1.0",
    counts = {
      entriesTotal = map_count(state.resolutionCache),
      mappedHosts = mapped,
      unmappedHosts = unmapped,
    },
    byProofState = by_proof,
    lastAppliedAt = state.bundleMeta and state.bundleMeta.appliedAt or nil,
    lastResolvedAt = state.lastResolvedAt,
    lastInvalidatedAt = state.cacheMeta and state.cacheMeta.lastInvalidatedAt or nil,
  }
end

function handlers.ResolveRouteForHost(msg)
  local ok, missing = validation.require_fields(msg, { "Host", "Path", "Method" })
  if not ok then
    return codec.error("INVALID_INPUT", "Missing field", { missing = missing })
  end

  local ok_extra, extras = validation.require_no_extras(msg, {
    "Action",
    "Request-Id",
    "Host",
    "Path",
    "Method",
    "Node-Id",
    "nodeId",
    "Resolver-Id",
    "Policy-Mode",
    "PolicyMode",
    "Schema-Version",
    "Query",
    "Actor-Role",
    "X-Caller",
    "Site-Id",
    "Signature",
  })
  if not ok_extra then
    return codec.error("UNSUPPORTED_FIELD", "Unexpected fields", { unexpected = extras })
  end

  local host, host_err = normalize_host(msg.Host, "Host")
  if not host then
    return codec.error("INVALID_INPUT", host_err, { field = "Host" })
  end
  local path, path_err = normalize_path(msg.Path, "Path")
  if not path then
    return codec.error("INVALID_INPUT", path_err, { field = "Path" })
  end
  local method, method_err = normalize_method(msg.Method, "Method")
  if not method then
    return codec.error("INVALID_INPUT", method_err, { field = "Method" })
  end

  local node_id, node_err = parse_node_id(msg)
  if node_err then
    return codec.error("INVALID_INPUT", node_err, { field = "Node-Id" })
  end

  local requested_mode = msg["Policy-Mode"] or msg.PolicyMode
  local mode, mode_fallback_reason = normalize_mode(requested_mode)
  local request_id = read_request_id(msg)
  local cache_key = make_cache_key("route", host, path, method, mode)
  local cached_entry, cache_state = get_cached_resolution(cache_key)
  if cached_entry then
    return codec.ok(payload_from_cached_entry(cached_entry, request_id, node_id, cache_state))
  end

  local host_policy = state.hostPolicies[host]
  local host_known = host_policy ~= nil
  local proof_payload = build_proof_payload(host)
  local decision, reason_code = evaluate_route_decision(mode, host_known, proof_payload.dnsProofState)
  if mode_fallback_reason then
    reason_code = mode_fallback_reason
  end

  local site_obj, process_obj = infer_site_process(host, host_policy)
  local action_hint, hint_source = resolve_action_hint(host, path, method, host_policy)
  state.lastResolvedAt = now_iso()

  local payload = {
    schemaVersion = "1.0",
    requestId = request_id,
    decision = decision,
    reasonCode = reason_code,
    mode = mode,
    host = host,
    path = path,
    method = method,
    nodeId = node_id,
    routeHint = {
      actionHint = action_hint,
      source = hint_source,
    },
    cache = build_cache_payload(host_known, proof_payload, "route", "miss"),
    proof = proof_payload,
  }

  if site_obj then
    payload.site = site_obj
  end
  if process_obj then
    payload.process = process_obj
  end

  upsert_resolution_cache(cache_key, host, {
    siteId = site_obj and site_obj.siteId or nil,
    decision = payload.decision,
    reasonCode = payload.reasonCode,
    mode = payload.mode,
    proofState = proof_payload.dnsProofState,
    dnsNextCheckAt = payload.cache.dnsNextCheckAt,
    surface = "route",
    actionHint = payload.routeHint.actionHint,
    hostKnown = host_known,
    path = path,
    method = method,
    process = process_obj,
    site = site_obj,
    proof = proof_payload,
  })
  return codec.ok(with_result_envelope(payload))
end

function handlers.ResolveHostForNode(msg)
  local host_input = msg.Host or msg.host
  if host_input == nil then
    return codec.error("INVALID_INPUT", "Missing field", { missing = { "Host" } })
  end

  local ok_extra, extras = validation.require_no_extras(msg, {
    "Action",
    "Request-Id",
    "Host",
    "host",
    "Node-Id",
    "nodeId",
    "Resolver-Id",
    "Policy-Mode",
    "PolicyMode",
    "Schema-Version",
    "Method",
    "Path",
    "Query",
    "Actor-Role",
    "X-Caller",
    "Site-Id",
    "Signature",
  })
  if not ok_extra then
    return codec.error("UNSUPPORTED_FIELD", "Unexpected fields", { unexpected = extras })
  end

  local host, host_err = normalize_host(host_input, "Host")
  if not host then
    return codec.error("INVALID_INPUT", host_err, { field = "Host" })
  end

  local node_id, node_err = parse_node_id(msg)
  if node_err then
    return codec.error("INVALID_INPUT", node_err, { field = "Node-Id" })
  end

  local requested_mode = msg["Policy-Mode"] or msg.PolicyMode
  local mode, mode_fallback_reason = normalize_mode(requested_mode)
  local request_id = read_request_id(msg)
  local cache_key = make_cache_key("host", host, nil, nil, mode)
  local cached_entry, cache_state = get_cached_resolution(cache_key)
  if cached_entry then
    return codec.ok(payload_from_cached_entry(cached_entry, request_id, node_id, cache_state))
  end

  local host_policy = state.hostPolicies[host]
  local host_known = host_policy ~= nil
  local site_obj, process_obj = infer_site_process(host, host_policy)
  local proof_payload = build_proof_payload(host)
  local decision, reason_code = evaluate_host_decision(mode, host_known, proof_payload.dnsProofState)
  if mode_fallback_reason then
    reason_code = mode_fallback_reason
  end

  state.lastResolvedAt = now_iso()

  local payload = {
    schemaVersion = "1.0",
    requestId = request_id,
    decision = decision,
    reasonCode = reason_code,
    mode = mode,
    host = host,
    nodeId = node_id,
    cache = build_cache_payload(host_known, proof_payload, "host", "miss"),
    proof = proof_payload,
  }

  if site_obj then
    payload.site = site_obj
  end
  if process_obj then
    payload.process = process_obj
  end

  upsert_resolution_cache(cache_key, host, {
    siteId = site_obj and site_obj.siteId or nil,
    decision = payload.decision,
    reasonCode = payload.reasonCode,
    mode = payload.mode,
    proofState = proof_payload.dnsProofState,
    dnsNextCheckAt = payload.cache.dnsNextCheckAt,
    surface = "host",
    actionHint = nil,
    hostKnown = host_known,
    path = nil,
    method = nil,
    process = process_obj,
    site = site_obj,
    proof = proof_payload,
  })

  return codec.ok(with_result_envelope(payload))
end

map_count = function(tbl)
  local count = 0
  for _ in pairs(tbl or {}) do
    count = count + 1
  end
  return count
end

function handlers.GetResolverState(_msg)
  ensure_cache_hints()
  return codec.ok {
    schemaVersion = "1.0",
    policyMode = normalize_mode(state.policyMode),
    failOpen = state.failOpen ~= false,
    cacheHints = {
      positiveTtlSec = state.cacheHints.positiveTtlSec,
      negativeTtlSec = state.cacheHints.negativeTtlSec,
      staleWhileRevalidateSec = state.cacheHints.staleWhileRevalidateSec,
      hardMaxStaleSec = state.cacheHints.hardMaxStaleSec,
    },
    counts = {
      hostPolicies = map_count(state.hostPolicies),
      sitePolicies = map_count(state.sitePolicies),
      routePolicies = map_count(state.routePolicies),
      dnsProofState = map_count(state.dnsProofState),
      resolutionCache = map_count(state.resolutionCache),
    },
    bundleMeta = state.bundleMeta,
    cacheMeta = state.cacheMeta,
    lastResolvedAt = state.lastResolvedAt,
    debugLevel = "safe",
  }
end

local function route(msg)
  local ok, missing = validation.require_tags(msg, { "Action" })
  if not ok then
    return codec.missing_tags(missing)
  end

  local ok_action, err = validation.require_action(msg, allowed_actions)
  if not ok_action then
    if err == "unknown_action" then
      return codec.unknown_action(msg.Action)
    end
    return codec.error("MISSING_ACTION", "Action is required")
  end

  prune_resolution_cache()

  local requires_auth = PUBLIC_READ_REQUIRE_AUTH or not public_read_actions[msg.Action]
  if requires_auth then
    local ok_sec, sec_err = auth.enforce(msg)
    if not ok_sec then
      return codec.error("FORBIDDEN", sec_err)
    end
  else
    local ok_rl, rl_err = auth.check_rate_limit(msg)
    if not ok_rl then
      return codec.error("FORBIDDEN", rl_err)
    end
  end

  local ok_hmac, hmac_err =
    auth.verify_outbox_hmac_for_action(msg, { skip_for = hmac_skip_actions })
  if not ok_hmac then
    return codec.error("FORBIDDEN", hmac_err)
  end

  local ok_role, role_err = auth.require_role_for_action(msg, role_policy)
  if not ok_role then
    return codec.error("FORBIDDEN", role_err)
  end

  local request_id = read_request_id(msg)
  local scope_host = tostring(msg.Host or msg.host or "")
  local scope_path = tostring(msg.Path or msg.path or "")
  local scope_method = string.upper(tostring(msg.Method or msg.method or ""))
  local idem_key = nil
  if request_id ~= "" then
    idem_key = table.concat({ request_id, tostring(msg.Action), scope_host, scope_path, scope_method }, "|")
    local seen = idem.check(idem_key)
    if seen then
      return seen
    end
  end

  local handler = handlers[msg.Action]
  if not handler then
    return codec.unknown_action(msg.Action)
  end

  local resp = handler(msg)
  metrics.inc("resolver." .. msg.Action .. ".count")
  metrics.tick()
  if idem_key ~= nil then
    idem.record(idem_key, resp)
  end
  maybe_persist_state(mutating_actions[msg.Action] == true)
  return resp
end

return {
  route = route,
  _state = state,
}
