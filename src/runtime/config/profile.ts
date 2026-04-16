export type GatewayResourceProfile = 'vps_small' | 'vps_medium' | 'diskless'

export function resolveGatewayResourceProfile(raw: string | undefined): GatewayResourceProfile | null {
  const value = (raw || '').trim().toLowerCase()
  if (!value) return null
  if (value === 'vps-small' || value === 'small' || value === 's' || value === 'vps_small') return 'vps_small'
  if (value === 'vps-medium' || value === 'medium' || value === 'm' || value === 'default' || value === 'vps_medium') return 'vps_medium'
  if (value === 'diskless' || value === 'memory-only' || value === 'memory_only' || value === 'ephemeral') return 'diskless'
  return null
}

function parseIntegerLike(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = parseIntegerLike(raw)
  if (parsed === null || parsed < min) return fallback
  return Math.min(parsed, max)
}

export function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value) || value < min) return fallback
  return Math.min(Math.floor(value), max)
}
