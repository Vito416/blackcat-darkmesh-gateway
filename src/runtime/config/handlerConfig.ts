import { loadIntegerConfig, loadStringConfig } from './loader.js'

export type HandlerIntegrityRole = 'root' | 'upgrade' | 'emergency' | 'reporter'
export type HandlerWebhookProvider = 'stripe' | 'paypal' | 'gopay'

export type IntegrityIncidentAuthConfig = {
  token: string
  requireSignatureRef: boolean
  refHeaderName: string
  roleRefs: Record<HandlerIntegrityRole, string[]>
  notify: {
    url?: string
    token?: string
    hmac?: string
  }
}

export type MetricsAuthConfig = {
  basicUser: string
  basicPass: string
  bearerToken: string
  needBasic: boolean
  needBearer: boolean
  mustGuard: boolean
}

export type HandlerWebhookConfig = {
  maxBodyBytes: number
  shadowInvalid: boolean
  stripeSecret: string
  stripeToleranceMs: number
  paypalWebhookSecret?: string
  gopayWebhookSecret: string
}

export type WorkerNotifyConfig = {
  target: string
  token: string
  hmacSecret: string
  breakerKey?: string
  breakerKeyStripe?: string
  breakerKeyPaypal?: string
  breakerKeyGopay?: string
}

function readRawEnv(name: string, env?: Record<string, string | undefined>): string | undefined {
  if (env) return env[name]
  const loaded = loadStringConfig(name)
  return loaded.ok ? loaded.value : undefined
}

export function readHandlerEnvString(
  name: string,
  env?: Record<string, string | undefined>,
): string | undefined {
  const loaded = loadStringConfig(name, { env })
  if (!loaded.ok) return undefined
  const value = typeof loaded.value === 'string' ? loaded.value.trim() : ''
  return value.length > 0 ? value : undefined
}

export function readHandlerStrictEnabledFlag(
  name: string,
  env?: Record<string, string | undefined>,
): boolean {
  return readHandlerEnvString(name, env) === '1'
}

export function readPositiveIntEnv(
  name: string,
  fallback: number,
  env?: Record<string, string | undefined>,
): number {
  const loaded = loadIntegerConfig(name, { env, fallbackValue: fallback })
  if (!loaded.ok) return fallback
  if (!Number.isFinite(loaded.value) || loaded.value <= 0) return fallback
  return Math.floor(loaded.value)
}

function splitRefsCsv(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function readTemplateToken(env?: Record<string, string | undefined>): string | undefined {
  return readRawEnv('GATEWAY_TEMPLATE_TOKEN', env)
}

export function readForgetToken(env?: Record<string, string | undefined>): string | undefined {
  return readRawEnv('GATEWAY_FORGET_TOKEN', env)
}

export function readIntegrityStateToken(env?: Record<string, string | undefined>): string {
  return readRawEnv('GATEWAY_INTEGRITY_STATE_TOKEN', env) || ''
}

export function readIntegrityIncidentAuthConfig(
  env?: Record<string, string | undefined>,
): IntegrityIncidentAuthConfig {
  return {
    token: readRawEnv('GATEWAY_INTEGRITY_INCIDENT_TOKEN', env) || '',
    requireSignatureRef: readRawEnv('GATEWAY_INTEGRITY_INCIDENT_REQUIRE_SIGNATURE_REF', env) === '1',
    refHeaderName: ((readRawEnv('GATEWAY_INTEGRITY_INCIDENT_REF_HEADER', env) || 'x-signature-ref')).trim(),
    roleRefs: {
      root: splitRefsCsv(readRawEnv('GATEWAY_INTEGRITY_ROLE_ROOT_REFS', env)),
      upgrade: splitRefsCsv(readRawEnv('GATEWAY_INTEGRITY_ROLE_UPGRADE_REFS', env)),
      emergency: splitRefsCsv(readRawEnv('GATEWAY_INTEGRITY_ROLE_EMERGENCY_REFS', env)),
      reporter: splitRefsCsv(readRawEnv('GATEWAY_INTEGRITY_ROLE_REPORTER_REFS', env)),
    },
    notify: {
      url: readHandlerEnvString('GATEWAY_INTEGRITY_INCIDENT_NOTIFY_URL', env),
      token: readHandlerEnvString('GATEWAY_INTEGRITY_INCIDENT_NOTIFY_TOKEN', env),
      hmac: readHandlerEnvString('GATEWAY_INTEGRITY_INCIDENT_NOTIFY_HMAC', env),
    },
  }
}

export function readMetricsAuthConfig(env?: Record<string, string | undefined>): MetricsAuthConfig {
  const basicUser = readRawEnv('METRICS_BASIC_USER', env) || ''
  const basicPass = readRawEnv('METRICS_BASIC_PASS', env) || ''
  const bearerToken = readRawEnv('METRICS_BEARER_TOKEN', env) || ''
  return {
    basicUser,
    basicPass,
    bearerToken,
    needBasic: !!(readRawEnv('METRICS_BASIC_USER', env) && readRawEnv('METRICS_BASIC_PASS', env)),
    needBearer: !!readRawEnv('METRICS_BEARER_TOKEN', env),
    mustGuard: readRawEnv('GATEWAY_REQUIRE_METRICS_AUTH', env) !== '0',
  }
}

export function readWebhookConfig(
  maxBodyBytesFallback: number,
  env?: Record<string, string | undefined>,
): HandlerWebhookConfig {
  return {
    maxBodyBytes: readPositiveIntEnv('GATEWAY_WEBHOOK_MAX_BODY_BYTES', maxBodyBytesFallback, env),
    shadowInvalid: readRawEnv('GATEWAY_WEBHOOK_SHADOW_INVALID', env) === '1',
    stripeSecret: readRawEnv('STRIPE_WEBHOOK_SECRET', env) || '',
    stripeToleranceMs: Number.parseInt(readRawEnv('STRIPE_WEBHOOK_TOLERANCE_MS', env) || '300000', 10),
    paypalWebhookSecret: readRawEnv('PAYPAL_WEBHOOK_SECRET', env) || undefined,
    gopayWebhookSecret: readRawEnv('GOPAY_WEBHOOK_SECRET', env) || '',
  }
}

export function readWorkerNotifyConfig(env?: Record<string, string | undefined>): WorkerNotifyConfig {
  return {
    target: readRawEnv('WORKER_NOTIFY_URL', env) || 'http://localhost:8787/notify',
    token: readRawEnv('WORKER_AUTH_TOKEN', env) || readRawEnv('WORKER_NOTIFY_TOKEN', env) || 'test-notify',
    hmacSecret: readRawEnv('WORKER_NOTIFY_HMAC', env) || '',
    breakerKey: readRawEnv('WORKER_NOTIFY_BREAKER_KEY', env),
    breakerKeyStripe: readRawEnv('WORKER_NOTIFY_BREAKER_KEY_STRIPE', env),
    breakerKeyPaypal: readRawEnv('WORKER_NOTIFY_BREAKER_KEY_PAYPAL', env),
    breakerKeyGopay: readRawEnv('WORKER_NOTIFY_BREAKER_KEY_GOPAY', env),
  }
}

export function resolveWorkerNotifyBreakerKey(config: WorkerNotifyConfig, provider?: string): string {
  if (provider === 'stripe' && config.breakerKeyStripe) return config.breakerKeyStripe
  if (provider === 'paypal' && config.breakerKeyPaypal) return config.breakerKeyPaypal
  if (provider === 'gopay' && config.breakerKeyGopay) return config.breakerKeyGopay
  return config.breakerKey || provider || 'gateway'
}
