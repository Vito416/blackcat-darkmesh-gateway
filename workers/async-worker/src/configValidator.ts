import type { DmTxtEnvelope, ValidationResult } from './dnsTxtParser.js'
import {
  verifyDmConfigSignature,
  type DmSignatureErrorCode
} from './configSignatureVerifier.js'

export type DmConfigErrorCode =
  | 'domain_invalid'
  | 'config_invalid_type'
  | 'config_missing_field'
  | 'config_invalid_field'
  | 'config_invalid_time_window'
  | 'config_kid_mismatch'
  | DmSignatureErrorCode

export type DmConfigValidationResult<T> = ValidationResult<T, DmConfigErrorCode>

export interface DmConfigV1 {
  v: 'dm1'
  domain: string
  siteProcess: string
  writeProcess: string
  entryPath: string
  validFrom: number
  validTo: number
  sigAlg: 'ed25519' | 'rsa-pss-sha256'
  sig: string
  nonce: string
  owner: string
  kid?: string
}

const PROCESS_ID_RE = /^[A-Za-z0-9_-]{20,128}$/
const SIG_RE = /^[A-Za-z0-9+/_=-]{32,8192}$/
const MAX_DOMAIN_LENGTH = 253

function fail(
  code: DmConfigErrorCode,
  message: string,
  field?: string
): DmConfigValidationResult<never> {
  return { ok: false, error: { code, message, field } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequiredString(
  object: Record<string, unknown>,
  field: string
): DmConfigValidationResult<string> {
  const value = object[field]
  if (typeof value !== 'string' || !value.trim()) {
    return fail('config_missing_field', `Missing or invalid string field: ${field}.`, field)
  }
  return { ok: true, value: value.trim() }
}

function readRequiredInteger(
  object: Record<string, unknown>,
  field: string
): DmConfigValidationResult<number> {
  const value = object[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return fail('config_invalid_field', `Field ${field} must be an integer.`, field)
  }

  if (value <= 0) {
    return fail('config_invalid_field', `Field ${field} must be greater than zero.`, field)
  }

  return { ok: true, value }
}

export function canonicalizeDomain(input: unknown): DmConfigValidationResult<string> {
  if (typeof input !== 'string') {
    return fail('domain_invalid', 'Domain must be a string.', 'domain')
  }

  const trimmed = input.trim().toLowerCase()
  if (!trimmed) {
    return fail('domain_invalid', 'Domain cannot be empty.', 'domain')
  }

  if (trimmed.includes('://') || trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#')) {
    return fail('domain_invalid', 'Domain must be a host only, without scheme or path.', 'domain')
  }

  const withoutTrailingDot = trimmed.replace(/\.+$/, '')
  if (!withoutTrailingDot) {
    return fail('domain_invalid', 'Domain cannot be only dots.', 'domain')
  }

  let canonicalHost = ''
  try {
    canonicalHost = new URL(`http://${withoutTrailingDot}`).hostname.toLowerCase()
  } catch {
    return fail('domain_invalid', 'Domain is not parseable as a valid hostname.', 'domain')
  }

  if (!canonicalHost || canonicalHost.length > MAX_DOMAIN_LENGTH || !canonicalHost.includes('.')) {
    return fail('domain_invalid', 'Domain must be a valid FQDN.', 'domain')
  }

  const labels = canonicalHost.split('.')
  for (const label of labels) {
    if (!label || label.length > 63) {
      return fail('domain_invalid', 'Domain label length is invalid.', 'domain')
    }
    if (!/^[a-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-')) {
      return fail('domain_invalid', 'Domain contains invalid characters.', 'domain')
    }
  }

  return { ok: true, value: canonicalHost }
}

export function validateDmConfigJson(input: unknown): DmConfigValidationResult<DmConfigV1> {
  if (!isPlainObject(input)) {
    return fail('config_invalid_type', 'Config payload must be a JSON object.', 'config')
  }

  const version = readRequiredString(input, 'v')
  if (!version.ok) return version
  if (version.value !== 'dm1') {
    return fail('config_invalid_field', 'Config v must be dm1.', 'v')
  }

  const domainField = readRequiredString(input, 'domain')
  if (!domainField.ok) return domainField
  const domain = canonicalizeDomain(domainField.value)
  if (!domain.ok) return domain

  const siteProcess = readRequiredString(input, 'siteProcess')
  if (!siteProcess.ok) return siteProcess
  if (!PROCESS_ID_RE.test(siteProcess.value)) {
    return fail('config_invalid_field', 'siteProcess format is invalid.', 'siteProcess')
  }

  const writeProcess = readRequiredString(input, 'writeProcess')
  if (!writeProcess.ok) return writeProcess
  if (!PROCESS_ID_RE.test(writeProcess.value)) {
    return fail('config_invalid_field', 'writeProcess format is invalid.', 'writeProcess')
  }

  const entryPath = readRequiredString(input, 'entryPath')
  if (!entryPath.ok) return entryPath
  if (!entryPath.value.startsWith('/')) {
    return fail('config_invalid_field', 'entryPath must start with "/".', 'entryPath')
  }

  const validFrom = readRequiredInteger(input, 'validFrom')
  if (!validFrom.ok) return validFrom

  const validTo = readRequiredInteger(input, 'validTo')
  if (!validTo.ok) return validTo
  if (validTo.value <= validFrom.value) {
    return fail('config_invalid_time_window', 'validTo must be greater than validFrom.', 'validTo')
  }

  const sigAlg = readRequiredString(input, 'sigAlg')
  if (!sigAlg.ok) return sigAlg
  if (sigAlg.value !== 'ed25519' && sigAlg.value !== 'rsa-pss-sha256') {
    return fail('config_invalid_field', 'sigAlg must be ed25519 or rsa-pss-sha256.', 'sigAlg')
  }

  const sig = readRequiredString(input, 'sig')
  if (!sig.ok) return sig
  if (!SIG_RE.test(sig.value)) {
    return fail('config_invalid_field', 'sig must be a base64/base64url-like string.', 'sig')
  }

  const owner = readRequiredString(input, 'owner')
  if (!owner.ok) return owner

  const nonce = readRequiredString(input, 'nonce')
  if (!nonce.ok) return nonce

  const optionalKidRaw = input.kid
  if (optionalKidRaw !== undefined && (typeof optionalKidRaw !== 'string' || !optionalKidRaw.trim())) {
    return fail('config_invalid_field', 'kid must be a non-empty string when provided.', 'kid')
  }

  return {
    ok: true,
    value: {
      v: 'dm1',
      domain: domain.value,
      siteProcess: siteProcess.value,
      writeProcess: writeProcess.value,
      entryPath: entryPath.value,
      validFrom: validFrom.value,
      validTo: validTo.value,
      sigAlg: sigAlg.value,
      sig: sig.value,
      owner: owner.value,
      nonce: nonce.value,
      kid: typeof optionalKidRaw === 'string' ? optionalKidRaw.trim() : undefined,
    }
  }
}

export function validateConfigKidAgainstTxt(
  config: DmConfigV1,
  txtEnvelope: DmTxtEnvelope
): DmConfigValidationResult<DmConfigV1> {
  const candidate = config.kid ?? config.owner
  if (candidate && candidate !== txtEnvelope.kid) {
    return fail('config_kid_mismatch', 'Config kid/owner does not match TXT kid.', 'kid')
  }
  return { ok: true, value: config }
}

export interface VerifyConfigSignatureOptions {
  publicKey: string | Uint8Array
  now?: number
}

export async function verifyValidatedDmConfigSignature(
  config: DmConfigV1,
  options: VerifyConfigSignatureOptions
): Promise<DmConfigValidationResult<DmConfigV1>> {
  const result = await verifyDmConfigSignature(config, options)
  if (!result.ok) {
    return result
  }
  return { ok: true, value: config }
}

export async function validateAndVerifyDmConfig(
  input: unknown,
  options: VerifyConfigSignatureOptions
): Promise<DmConfigValidationResult<DmConfigV1>> {
  const parsed = validateDmConfigJson(input)
  if (!parsed.ok) {
    return parsed
  }
  return verifyValidatedDmConfigSignature(parsed.value, options)
}
