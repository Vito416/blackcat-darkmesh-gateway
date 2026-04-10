import { createHash, createHmac } from 'node:crypto'

const VALID_PROTOCOLS = new Set(['http:', 'https:'])
const SCRIPT_VERSION_TAG = 'integrity-attestation-v1'
const ARTIFACT_TYPE = 'gateway-integrity-attestation'
const COMPARED_FIELDS = [
  ['policy.paused', ['policy', 'paused']],
  ['policy.activeRoot', ['policy', 'activeRoot']],
  ['policy.activePolicyHash', ['policy', 'activePolicyHash']],
  ['release.version', ['release', 'version']],
  ['release.root', ['release', 'root']],
  ['audit.seqTo', ['audit', 'seqTo']],
]

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry))
  const out = {}
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (typeof entry !== 'undefined') {
      out[key] = canonicalize(entry)
    }
  }
  return out
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex')
}

function signHmac(secret, text) {
  return createHmac('sha256', secret).update(text).digest('hex')
}

function deepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function getField(snapshot, path) {
  let current = snapshot
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) return { found: false }
    current = current[key]
  }
  return { found: true, value: current }
}

function extractComparedFields(results, fields = COMPARED_FIELDS) {
  const comparedFields = []
  let mismatchCount = 0
  let invalidFieldCount = 0

  for (const [field, path] of fields) {
    const values = results.map((result) => {
      const entry = getField(result.snapshot, path)
      return {
        gateway: result.label,
        url: result.url,
        found: entry.found,
        value: entry.found ? entry.value : null,
      }
    })

    if (values.some((entry) => !entry.found)) {
      invalidFieldCount += 1
      comparedFields.push({
        field,
        status: 'invalid',
        values,
      })
      continue
    }

    const consensus = values.every((entry) => deepEqual(entry.value, values[0].value))
    if (!consensus) mismatchCount += 1
    comparedFields.push({
      field,
      status: consensus ? 'consensus' : 'mismatch',
      values,
    })
  }

  return { comparedFields, mismatchCount, invalidFieldCount }
}

function buildCanonicalSegment({
  results,
  comparison,
  generatedAt,
  scriptVersionTag = SCRIPT_VERSION_TAG,
  artifactType = ARTIFACT_TYPE,
}) {
  return {
    artifactType,
    scriptVersionTag,
    generatedAt,
    gateways: results.map((result) => ({
      label: result.label,
      url: result.url,
      snapshot: result.snapshot,
    })),
    comparedFields: comparison.comparedFields,
    summary: {
      mismatchCount: comparison.mismatchCount,
      invalidFieldCount: comparison.invalidFieldCount,
      gatewayCount: results.length,
    },
  }
}

function createDeterministicDigest(canonicalText) {
  return `sha256:${sha256Hex(canonicalText)}`
}

function buildAttestationArtifact({
  results,
  comparison = extractComparedFields(results),
  generatedAt = new Date().toISOString(),
  scriptVersionTag = SCRIPT_VERSION_TAG,
  artifactType = ARTIFACT_TYPE,
  hmacEnvName = '',
  hmacSecret = '',
} = {}) {
  const canonicalSegment = buildCanonicalSegment({
    results,
    comparison,
    generatedAt,
    scriptVersionTag,
    artifactType,
  })
  const canonicalText = canonicalJson(canonicalSegment)
  const artifact = {
    ...canonicalSegment,
    digest: createDeterministicDigest(canonicalText),
  }

  if (typeof hmacEnvName === 'string' && hmacEnvName.trim() && typeof hmacSecret === 'string' && hmacSecret.trim()) {
    artifact.hmacEnv = hmacEnvName
    artifact.hmacSha256 = `sha256:${signHmac(hmacSecret, canonicalText)}`
  }

  return { artifact, canonicalText, canonicalSegment }
}

export {
  VALID_PROTOCOLS,
  SCRIPT_VERSION_TAG,
  ARTIFACT_TYPE,
  COMPARED_FIELDS,
  canonicalize,
  canonicalJson,
  sha256Hex,
  signHmac,
  getField,
  extractComparedFields,
  buildCanonicalSegment,
  createDeterministicDigest,
  buildAttestationArtifact,
}
