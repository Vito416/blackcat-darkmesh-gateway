export type DmTxtErrorCode =
  | 'txt_invalid_type'
  | 'txt_empty'
  | 'txt_invalid_pair'
  | 'txt_duplicate_key'
  | 'txt_unknown_key'
  | 'txt_missing_field'
  | 'txt_invalid_version'
  | 'txt_invalid_cfg'
  | 'txt_invalid_kid'
  | 'txt_invalid_ttl'

export type ValidationResult<T, Code extends string> =
  | { ok: true; value: T }
  | { ok: false; error: { code: Code; message: string; field?: string } }

export interface DmTxtEnvelope {
  v: 'dm1'
  cfg: string
  kid: string
  ttl: number
}

type ParsedTxtPairs = Record<'v' | 'cfg' | 'kid' | 'ttl', string>

const CFG_TX_RE = /^[A-Za-z0-9_-]{32,128}$/
const KID_RE = /^[A-Za-z0-9_-]{32,128}$/
const TXT_KEYS = new Set(['v', 'cfg', 'kid', 'ttl'])
const REQUIRED_KEYS: Array<keyof ParsedTxtPairs> = ['v', 'cfg', 'kid', 'ttl']
const MIN_TTL_SECONDS = 60
const MAX_TTL_SECONDS = 86400

function fail(
  code: DmTxtErrorCode,
  message: string,
  field?: string
): ValidationResult<never, DmTxtErrorCode> {
  return { ok: false, error: { code, message, field } }
}

function parsePairs(rawTxt: string): ValidationResult<Record<string, string>, DmTxtErrorCode> {
  const result: Record<string, string> = {}
  const segments = rawTxt.split(';')

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) {
      continue
    }

    const eqIdx = trimmed.indexOf('=')
    if (eqIdx <= 0 || eqIdx === trimmed.length - 1) {
      return fail('txt_invalid_pair', 'TXT segment must be key=value.', 'txt')
    }

    const key = trimmed.slice(0, eqIdx).trim().toLowerCase()
    const value = trimmed.slice(eqIdx + 1).trim()

    if (!TXT_KEYS.has(key)) {
      return fail('txt_unknown_key', `Unsupported TXT key: ${key}.`, key)
    }

    if (Object.hasOwn(result, key)) {
      return fail('txt_duplicate_key', `Duplicate TXT key: ${key}.`, key)
    }

    result[key] = value
  }

  return { ok: true, value: result }
}

export function parseDmTxtPayload(raw: unknown): ValidationResult<ParsedTxtPairs, DmTxtErrorCode> {
  if (typeof raw !== 'string') {
    return fail('txt_invalid_type', 'TXT payload must be a string.', 'txt')
  }

  const txt = raw.trim()
  if (!txt) {
    return fail('txt_empty', 'TXT payload cannot be empty.', 'txt')
  }

  const pairsResult = parsePairs(txt)
  if (!pairsResult.ok) {
    return pairsResult
  }

  for (const key of REQUIRED_KEYS) {
    if (!pairsResult.value[key]) {
      return fail('txt_missing_field', `Missing TXT field: ${key}.`, key)
    }
  }

  return { ok: true, value: pairsResult.value as ParsedTxtPairs }
}

export function validateDmTxtEnvelope(
  parsed: ParsedTxtPairs
): ValidationResult<DmTxtEnvelope, DmTxtErrorCode> {
  if (parsed.v !== 'dm1') {
    return fail('txt_invalid_version', 'Unsupported TXT version. Expected dm1.', 'v')
  }

  if (!CFG_TX_RE.test(parsed.cfg)) {
    return fail('txt_invalid_cfg', 'cfg must be a valid Arweave transaction id.', 'cfg')
  }

  if (!KID_RE.test(parsed.kid)) {
    return fail('txt_invalid_kid', 'kid must be a valid Arweave address format.', 'kid')
  }

  if (!/^\d+$/.test(parsed.ttl)) {
    return fail('txt_invalid_ttl', 'ttl must be an integer in seconds.', 'ttl')
  }

  const ttl = Number.parseInt(parsed.ttl, 10)
  if (ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    return fail(
      'txt_invalid_ttl',
      `ttl must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS} seconds.`,
      'ttl'
    )
  }

  return {
    ok: true,
    value: {
      v: 'dm1',
      cfg: parsed.cfg,
      kid: parsed.kid,
      ttl
    }
  }
}

export function parseAndValidateDmTxtEnvelope(
  raw: unknown
): ValidationResult<DmTxtEnvelope, DmTxtErrorCode> {
  const parsed = parseDmTxtPayload(raw)
  if (!parsed.ok) {
    return parsed
  }

  return validateDmTxtEnvelope(parsed.value)
}

