const VALID_PROTOCOLS = new Set(['http:', 'https:'])

const COMPARED_FIELDS = [
  ['policy.paused', ['policy', 'paused']],
  ['policy.activeRoot', ['policy', 'activeRoot']],
  ['policy.activePolicyHash', ['policy', 'activePolicyHash']],
  ['release.version', ['release', 'version']],
  ['release.root', ['release', 'root']],
  ['audit.seqTo', ['audit', 'seqTo']],
]

function validateGatewayUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch (_) {
    throw new Error(`invalid url: ${value}`)
  }

  if (!VALID_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`unsupported url protocol: ${value}`)
  }

  return parsed.toString()
}

function parseGatewayUrls(urls, { minUrls = 2 } = {}) {
  if (!Array.isArray(urls)) {
    throw new Error('urls must be an array')
  }
  if (urls.length < minUrls) {
    throw new Error('at least two --url values are required')
  }
  return urls.map((url) => validateGatewayUrl(url))
}

function resolveTokensForUrls(urls, tokens = [], envToken = '', options = {}) {
  const normalizedTokens = Array.isArray(tokens) ? tokens : []
  const trimmedEnvToken = typeof envToken === 'string' ? envToken.trim() : ''
  const allowAnonymous = options?.allowAnonymous === true

  for (const token of normalizedTokens) {
    if (typeof token !== 'string' || !token.trim()) {
      throw new Error('--token values must not be blank')
    }
  }

  if (normalizedTokens.length > 0 && normalizedTokens.length !== 1 && normalizedTokens.length !== urls.length) {
    throw new Error('pass either one --token for all URLs or one --token per URL')
  }

  if (normalizedTokens.length === urls.length) return normalizedTokens.slice()
  if (normalizedTokens.length === 1) return urls.map(() => normalizedTokens[0])
  if (allowAnonymous) return urls.map(() => '')
  if (!trimmedEnvToken) {
    throw new Error('missing token: set GATEWAY_INTEGRITY_STATE_TOKEN or pass --token')
  }
  return urls.map(() => envToken)
}

function getField(snapshot, path) {
  let current = snapshot
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return { found: false }
    }
    current = current[key]
  }
  return { found: true, value: current }
}

function formatValue(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function buildComparisonReport(results, fields = COMPARED_FIELDS) {
  const rows = []
  let mismatches = 0
  let invalid = false

  for (const [field, path] of fields) {
    const values = results.map((result) => getField(result.snapshot, path))
    const missing = values.find((entry) => !entry.found)
    if (missing) {
      invalid = true
      rows.push({
        field,
        status: 'INVALID',
        details: 'missing field in one or more snapshots',
        values: null,
      })
      continue
    }

    const renderedValues = values.map((entry) => entry.value)
    const consensus = renderedValues.every((value) => Object.is(value, renderedValues[0]))
    if (!consensus) {
      mismatches += 1
    }
    rows.push({
      field,
      status: consensus ? 'CONSENSUS' : 'MISMATCH',
      details: renderedValues.map((value, idx) => `${results[idx].label}=${formatValue(value)}`).join(' | '),
      values: renderedValues,
    })
  }

  return {
    rows,
    mismatches,
    invalid,
    totalFields: fields.length,
  }
}

export {
  VALID_PROTOCOLS,
  COMPARED_FIELDS,
  validateGatewayUrl,
  parseGatewayUrls,
  resolveTokensForUrls,
  getField,
  formatValue,
  buildComparisonReport,
}
