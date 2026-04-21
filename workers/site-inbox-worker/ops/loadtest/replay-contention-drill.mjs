#!/usr/bin/env node

import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function readArg(flag, fallback = '') {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return fallback
  const value = process.argv[idx + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${flag}`)
  }
  return value
}

function hasArg(flag) {
  return process.argv.includes(flag)
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

function normalizeBaseUrl(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) {
    throw new Error('WORKER_BASE_URL (or --base-url) is required')
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function signInboxBody(body, secret) {
  if (!secret) return null
  return createHmac('sha256', secret).update(body).digest('hex')
}

async function writeJsonFile(path, value) {
  const outPath = resolve(path)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return outPath
}

async function run() {
  const baseUrl = normalizeBaseUrl(readArg('--base-url', process.env.WORKER_BASE_URL || ''))
  const attempts = parsePositiveInt(
    readArg('--attempts', process.env.REPLAY_DRILL_ATTEMPTS || '4'),
    4,
  )
  const subject = readArg(
    '--subject',
    process.env.REPLAY_DRILL_SUBJECT || `replay-drill-${Date.now()}`,
  )
  const nonce = readArg('--nonce', process.env.REPLAY_DRILL_NONCE || 'collision-1')
  const payload = readArg('--payload', process.env.REPLAY_DRILL_PAYLOAD || 'cipher')
  const inboxHmacSecret = process.env.INBOX_HMAC_SECRET || ''
  const outputFile = readArg('--out', process.env.REPLAY_DRILL_OUT || '')

  const body = JSON.stringify({ subject, nonce, payload })
  const signature = signInboxBody(body, inboxHmacSecret)
  const url = `${baseUrl}/inbox`

  const startedAt = new Date().toISOString()
  const requests = Array.from({ length: attempts }, async (_, index) => {
    const headers = { 'content-type': 'application/json' }
    if (signature) headers['x-signature'] = signature

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
    })
    const text = await res.text()
    return {
      index: index + 1,
      status: res.status,
      body: text.slice(0, 512),
    }
  })

  const results = await Promise.all(requests)
  const counts = {}
  for (const row of results) {
    const key = String(row.status)
    counts[key] = (counts[key] || 0) + 1
  }

  const created = counts['201'] || 0
  const replay409 = counts['409'] || 0
  const serverErrors = Object.keys(counts)
    .map((status) => Number(status))
    .filter((status) => status >= 500)
    .reduce((sum, status) => sum + (counts[String(status)] || 0), 0)
  const pass = created === 1 && replay409 === attempts - 1 && serverErrors === 0

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    attempts,
    subject,
    nonce,
    hasHmac: !!signature,
    counts,
    pass,
    results,
  }

  if (outputFile) {
    report.outputFile = await writeJsonFile(outputFile, report)
  }

  if (hasArg('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(`replay-contention-drill: ${pass ? 'pass' : 'fail'}\n`)
    process.stdout.write(`baseUrl=${baseUrl} attempts=${attempts} subject=${subject} nonce=${nonce}\n`)
    process.stdout.write(`counts=${JSON.stringify(counts)}\n`)
    if (report.outputFile) {
      process.stdout.write(`report=${report.outputFile}\n`)
    }
  }

  process.exit(pass ? 0 : 3)
}

run().catch((error) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(3)
})
