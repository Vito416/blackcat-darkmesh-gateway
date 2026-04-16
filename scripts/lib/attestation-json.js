import { createHash } from 'node:crypto'

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

function expectedAttestationDigest(artifact) {
  const segment = {
    artifactType: artifact.artifactType,
    scriptVersionTag: artifact.scriptVersionTag,
    generatedAt: artifact.generatedAt,
    gateways: artifact.gateways,
    comparedFields: artifact.comparedFields,
    summary: artifact.summary,
  }
  return `sha256:${sha256Hex(canonicalJson(segment))}`
}

export {
  canonicalize,
  canonicalJson,
  sha256Hex,
  expectedAttestationDigest,
}
