#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const LOCAL_HOST = '127.0.0.1'
const LOCAL_ALLOWED_HOSTS = new Set([LOCAL_HOST, 'localhost'])
const SITE_ID = 'smoke-site'
const TEMPLATE_TOKEN = 'smoke-template-token'
const WORKER_TOKEN = 'smoke-worker-token'
const SIGNATURE = 'smoke-signature-deadbeef'
const SIGNATURE_REF = 'worker-smoke-ref'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function headerValue(headers, name) {
  const raw = headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0] || ''
  return typeof raw === 'string' ? raw : ''
}

async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch (_) {
    throw new Error(`${label} is not valid JSON`)
  }
}

function requestUrlPath(rawPath) {
  try {
    return new URL(rawPath || '/', 'http://mock.local').pathname
  } catch (_) {
    return '/'
  }
}

async function startMockServer(label, responder) {
  const requests = []
  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req)
    const record = {
      method: req.method || 'GET',
      path: requestUrlPath(req.url || '/'),
      headers: { ...req.headers },
      body,
    }
    requests.push(record)

    try {
      const response = await responder(record)
      const status = response?.status || 200
      const headers = response?.headers || { 'content-type': 'application/json' }
      const replyBody = typeof response?.body === 'string' ? response.body : JSON.stringify(response?.body ?? {})
      res.writeHead(status, headers)
      res.end(replyBody)
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `${label}_mock_failed`, message }))
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOCAL_HOST, () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(() => resolve()))
    throw new Error(`failed to resolve ${label} mock address`)
  }

  return {
    baseUrl: `http://${LOCAL_HOST}:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      }),
  }
}

function normalizeFetchUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return new URL(String(input))
  if (input && typeof input === 'object' && 'url' in input && typeof input.url === 'string') return new URL(input.url)
  throw new Error('unable to resolve fetch url')
}

function runWithPatchedEnv(patch, fn) {
  const original = {}
  for (const [key, value] of Object.entries(patch)) {
    original[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  const restore = () => {
    for (const [key, value] of Object.entries(original)) {
      if (typeof value === 'undefined') delete process.env[key]
      else process.env[key] = value
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(restore)
}

function buildReadRequest(traceId) {
  return new Request('http://gateway/template/call', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-template-token': TEMPLATE_TOKEN,
      'x-trace-id': traceId,
      'cf-connecting-ip': '203.0.113.44',
    },
    body: JSON.stringify({
      action: 'public.resolve-route',
      requestId: 'smoke-read-req-1',
      siteId: SITE_ID,
      payload: {
        host: 'shop.example.test',
        path: '/smoke-read',
      },
    }),
  })
}

function buildWriteRequest(traceId) {
  return new Request('http://gateway/template/call', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-template-token': TEMPLATE_TOKEN,
      'x-trace-id': traceId,
      'cf-connecting-ip': '203.0.113.45',
    },
    body: JSON.stringify({
      action: 'checkout.create-order',
      requestId: 'smoke-write-req-1',
      actor: 'smoke-tester',
      payload: {
        siteId: SITE_ID,
        items: [{ sku: 'sku-smoke', qty: 1 }],
      },
    }),
  })
}

function validateReadForward(record, traceId) {
  assert(record.method === 'POST', `read upstream expected POST, got ${record.method}`)
  assert(record.path === '/api/public/resolve-route', `read upstream path mismatch: ${record.path}`)
  assert(headerValue(record.headers, 'x-template-action') === 'public.resolve-route', 'missing read x-template-action')
  assert(headerValue(record.headers, 'x-request-id') === 'smoke-read-req-1', 'missing read x-request-id')
  assert(headerValue(record.headers, 'x-site-id') === SITE_ID, 'missing read x-site-id')
  assert(headerValue(record.headers, 'x-trace-id') === traceId, 'missing read x-trace-id')

  const body = parseJson(record.body, 'read upstream body')
  assert(body.action === 'public.resolve-route', 'read body action mismatch')
  assert(body.requestId === 'smoke-read-req-1', 'read body requestId mismatch')
  assert(body.siteId === SITE_ID, 'read body siteId mismatch')
  assert(body.payload?.path === '/smoke-read', 'read body payload.path mismatch')
  assert(body.payload?.host === 'shop.example.test', 'read body payload.host mismatch')
  assert(typeof body.signature === 'undefined', 'read body must not include write signature')
}

function validateSignerForward(record, traceId) {
  assert(record.method === 'POST', `signer expected POST, got ${record.method}`)
  assert(record.path === '/sign', `signer path mismatch: ${record.path}`)
  assert(headerValue(record.headers, 'authorization') === `Bearer ${WORKER_TOKEN}`, 'missing signer authorization')
  assert(headerValue(record.headers, 'x-trace-id') === traceId, 'missing signer x-trace-id')

  const body = parseJson(record.body, 'signer body')
  assert(body.action === 'CreateOrder', 'signer body action mismatch')
  assert(body.requestId === 'smoke-write-req-1', 'signer body requestId mismatch')
  assert(body.actor === 'smoke-tester', 'signer body actor mismatch')
  assert(body.tenant === SITE_ID, 'signer body tenant mismatch')
  assert(body.payload?.siteId === SITE_ID, 'signer payload siteId mismatch')
  assert(Array.isArray(body.payload?.items), 'signer payload items missing')
}

function validateWriteForward(record, traceId) {
  assert(record.method === 'POST', `write upstream expected POST, got ${record.method}`)
  assert(record.path === '/api/checkout/order', `write upstream path mismatch: ${record.path}`)
  assert(headerValue(record.headers, 'x-template-action') === 'checkout.create-order', 'missing write x-template-action')
  assert(headerValue(record.headers, 'x-request-id') === 'smoke-write-req-1', 'missing write x-request-id')
  assert(headerValue(record.headers, 'x-site-id') === SITE_ID, 'missing write x-site-id')
  assert(headerValue(record.headers, 'x-trace-id') === traceId, 'missing write x-trace-id')

  const body = parseJson(record.body, 'write upstream body')
  assert(body.action === 'CreateOrder', 'write body action mismatch')
  assert(body.templateAction === 'checkout.create-order', 'write body templateAction mismatch')
  assert(body.requestId === 'smoke-write-req-1', 'write body requestId mismatch')
  assert(body.actor === 'smoke-tester', 'write body actor mismatch')
  assert(body.tenant === SITE_ID, 'write body tenant mismatch')
  assert(body.siteId === SITE_ID, 'write body siteId mismatch')
  assert(body.role === 'shop_admin', 'write body role mismatch')
  assert(body.signature === SIGNATURE, 'write body signature mismatch')
  assert(body.signatureRef === SIGNATURE_REF, 'write body signatureRef mismatch')
}

export async function runTemplateDataflowSmoke({ handleRequest } = {}) {
  assert(typeof handleRequest === 'function', 'runTemplateDataflowSmoke requires handleRequest')
  const nativeFetch = globalThis.fetch
  assert(typeof nativeFetch === 'function', 'global fetch is required')

  const readUpstream = await startMockServer('read', (record) => {
    if (record.path !== '/api/public/resolve-route') {
      return { status: 404, body: { error: 'unexpected_read_path', path: record.path } }
    }
    return { status: 200, body: { ok: true, source: 'read-mock' } }
  })
  const signerUpstream = await startMockServer('signer', (record) => {
    if (record.path !== '/sign') {
      return { status: 404, body: { error: 'unexpected_signer_path', path: record.path } }
    }
    return { status: 200, body: { signature: SIGNATURE, signatureRef: SIGNATURE_REF } }
  })
  const writeUpstream = await startMockServer('write', (record) => {
    if (record.path !== '/api/checkout/order') {
      return { status: 404, body: { error: 'unexpected_write_path', path: record.path } }
    }
    return { status: 201, body: { ok: true, accepted: true } }
  })

  globalThis.fetch = async (input, init) => {
    const url = normalizeFetchUrl(input)
    if (!LOCAL_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error(`outbound network is blocked during smoke run: ${url.hostname}`)
    }
    return nativeFetch(input, init)
  }

  try {
    const envPatch = {
      AO_PUBLIC_API_URL: readUpstream.baseUrl,
      AO_READ_URL: '',
      WRITE_API_URL: writeUpstream.baseUrl,
      WORKER_API_URL: signerUpstream.baseUrl,
      WORKER_SIGN_URL: '',
      WORKER_AUTH_TOKEN: WORKER_TOKEN,
      WORKER_SIGN_TOKEN: '',
      GATEWAY_TEMPLATE_ALLOW_MUTATIONS: '1',
      GATEWAY_TEMPLATE_TOKEN: TEMPLATE_TOKEN,
      GATEWAY_TEMPLATE_TARGET_HOST_ALLOWLIST: '127.0.0.1,localhost',
      GATEWAY_TEMPLATE_WORKER_URL_MAP: '',
      GATEWAY_TEMPLATE_WORKER_TOKEN_MAP: '',
      GATEWAY_TEMPLATE_WORKER_SIGNATURE_REF_MAP: '',
      GATEWAY_TEMPLATE_VARIANT_MAP: '',
      GATEWAY_TEMPLATE_UPSTREAM_AUTH_MODE: 'none',
      GATEWAY_TEMPLATE_UPSTREAM_TOKEN: '',
      GATEWAY_TEMPLATE_UPSTREAM_TOKEN_MAP: '',
      GATEWAY_SITE_ID_BY_HOST_MAP: '',
      AO_INTEGRITY_URL: '',
    }

    await runWithPatchedEnv(envPatch, async () => {
      const readTraceId = 'smoke-read-trace-1'
      const readResponse = await handleRequest(buildReadRequest(readTraceId))
      assert(readResponse.status === 200, `read smoke expected 200, got ${readResponse.status}`)
      assert((await readResponse.text()).includes('"source":"read-mock"'), 'read smoke response body mismatch')

      const writeTraceId = 'smoke-write-trace-1'
      const writeResponse = await handleRequest(buildWriteRequest(writeTraceId))
      assert(writeResponse.status === 201, `write smoke expected 201, got ${writeResponse.status}`)
      assert((await writeResponse.text()).includes('"accepted":true'), 'write smoke response body mismatch')

      assert(readUpstream.requests.length === 1, `expected 1 read upstream call, got ${readUpstream.requests.length}`)
      assert(signerUpstream.requests.length === 1, `expected 1 signer call, got ${signerUpstream.requests.length}`)
      assert(writeUpstream.requests.length === 1, `expected 1 write upstream call, got ${writeUpstream.requests.length}`)

      validateReadForward(readUpstream.requests[0], readTraceId)
      validateSignerForward(signerUpstream.requests[0], writeTraceId)
      validateWriteForward(writeUpstream.requests[0], writeTraceId)
    })

    return {
      ok: true,
      read: {
        upstreamPath: readUpstream.requests[0]?.path || '',
        requestId: 'smoke-read-req-1',
      },
      write: {
        signerPath: signerUpstream.requests[0]?.path || '',
        upstreamPath: writeUpstream.requests[0]?.path || '',
        requestId: 'smoke-write-req-1',
        signatureRef: SIGNATURE_REF,
      },
    }
  } finally {
    globalThis.fetch = nativeFetch
    await Promise.all([readUpstream.close(), signerUpstream.close(), writeUpstream.close()])
  }
}

async function importBuiltHandler() {
  const buildDir = new URL('../dist/', import.meta.url)
  const handlerUrl = new URL('handler.js', buildDir)
  if (!existsSync(handlerUrl)) {
    throw new Error(`missing build output: ${handlerUrl.pathname} (run "npm run build" first)`)
  }
  return import(handlerUrl.href)
}

async function main() {
  const { handleRequest } = await importBuiltHandler()
  const result = await runTemplateDataflowSmoke({ handleRequest })
  if (!result.ok) throw new Error('smoke run did not complete')
  console.log('[SMOKE] PASS template dataflow contracts validated')
}

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : `${error}`
    console.error(`[SMOKE] FAIL template dataflow: ${message}`)
    process.exit(1)
  })
}
