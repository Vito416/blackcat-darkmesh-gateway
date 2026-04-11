import { inc } from '../../metrics.js'
import { loadIntegerConfig, loadStringConfig } from '../config/loader.js'

export type ForgetForwardConfig = {
  url?: string
  token?: string
  timeoutMs: number
}

export type ForgetForwardPayload = {
  subject?: string
  key?: string
  removed: number
  ts: string
}

export type ForgetForwardResult = {
  forwarded: boolean
  attempted: boolean
}

const DEFAULT_TIMEOUT_MS = 3000

function readStringEnv(name: string): string | undefined {
  const loaded = loadStringConfig(name)
  if (!loaded.ok || typeof loaded.value !== 'string') return undefined
  const value = loaded.value.trim()
  return value.length > 0 ? value : undefined
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const loaded = loadIntegerConfig(name, { fallbackValue: fallback })
  if (!loaded.ok) return fallback
  if (!Number.isFinite(loaded.value) || loaded.value <= 0) return fallback
  return Math.floor(loaded.value)
}

export function readForgetForwardConfig(): ForgetForwardConfig {
  return {
    url: readStringEnv('GATEWAY_FORGET_FORWARD_URL'),
    token: readStringEnv('GATEWAY_FORGET_FORWARD_TOKEN'),
    timeoutMs: readPositiveIntegerEnv('GATEWAY_FORGET_FORWARD_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
  }
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

export async function forwardForgetEvent(
  payload: ForgetForwardPayload,
  config: ForgetForwardConfig = readForgetForwardConfig(),
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ForgetForwardResult> {
  const url = typeof config.url === 'string' ? config.url.trim() : ''
  if (!url) {
    inc('gateway_cache_forget_forward_skipped')
    return { forwarded: false, attempted: false }
  }

  if (typeof fetchImpl !== 'function') {
    inc('gateway_cache_forget_forward_failed')
    return { forwarded: false, attempted: true }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (config.token) headers.authorization = `Bearer ${config.token}`

  inc('gateway_cache_forget_forward_attempt')

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (response.ok) {
      inc('gateway_cache_forget_forward_success')
      return { forwarded: true, attempted: true }
    }

    inc('gateway_cache_forget_forward_failed')
    return { forwarded: false, attempted: true }
  } catch (error) {
    if (isAbortError(error)) {
      inc('gateway_cache_forget_forward_timeout')
    } else {
      inc('gateway_cache_forget_forward_failed')
    }
    return { forwarded: false, attempted: true }
  } finally {
    clearTimeout(timer)
  }
}
