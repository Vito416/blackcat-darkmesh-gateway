import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadStringConfig } from './runtime/config/loader.js'

export type TemplateContractAction = {
  name: string
  method: 'POST'
  path: string
  auth: { requiredRole: string }
  requestSchemaRef: string
  responseSchemaRef: string
  ratelimitProfile: string
  idempotency: { mode: 'required' | 'optional' | 'forbidden'; keyHeader?: string }
}

type TemplateContract = {
  schemaVersion: string
  templateId: string
  templateVersion: string
  allowedActions: TemplateContractAction[]
}

const DEFAULT_CONTRACT_PATH = 'config/template-backend-contract.json'

let cachePath = ''
let cacheContract: TemplateContract | null = null

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function readContractPath(): string {
  const loaded = loadStringConfig('GATEWAY_TEMPLATE_CONTRACT_FILE')
  const contractPath =
    loaded.ok && typeof loaded.value === 'string' && loaded.value.length > 0
      ? loaded.value
      : DEFAULT_CONTRACT_PATH
  return resolve(contractPath)
}

function parseAction(v: unknown): TemplateContractAction | null {
  if (!isObj(v)) return null
  const name = asString(v.name)
  const method = asString(v.method).toUpperCase()
  const path = asString(v.path)
  const auth = isObj(v.auth) ? v.auth : null
  const requiredRole = auth ? asString(auth.requiredRole) : ''
  const requestSchemaRef = asString(v.requestSchemaRef)
  const responseSchemaRef = asString(v.responseSchemaRef)
  const ratelimitProfile = asString(v.ratelimitProfile)
  const idempotency = isObj(v.idempotency) ? v.idempotency : null
  const mode = idempotency ? asString(idempotency.mode).toLowerCase() : ''
  const keyHeader = idempotency ? asString(idempotency.keyHeader) : ''

  if (!name || method !== 'POST' || !path.startsWith('/') || !requiredRole) return null
  if (!requestSchemaRef || !responseSchemaRef || !ratelimitProfile) return null
  if (!['required', 'optional', 'forbidden'].includes(mode)) return null

  return {
    name,
    method: 'POST',
    path,
    auth: { requiredRole },
    requestSchemaRef,
    responseSchemaRef,
    ratelimitProfile,
    idempotency: keyHeader ? { mode: mode as TemplateContractAction['idempotency']['mode'], keyHeader } : { mode: mode as TemplateContractAction['idempotency']['mode'] },
  }
}

function parseContract(raw: unknown): TemplateContract | null {
  if (!isObj(raw)) return null
  const schemaVersion = asString(raw.schemaVersion)
  const templateId = asString(raw.templateId)
  const templateVersion = asString(raw.templateVersion)
  const actionsRaw = Array.isArray(raw.allowedActions) ? raw.allowedActions : []
  if (!schemaVersion || !templateId || !templateVersion || actionsRaw.length === 0) return null

  const allowedActions: TemplateContractAction[] = []
  for (const actionRaw of actionsRaw) {
    const action = parseAction(actionRaw)
    if (!action) return null
    allowedActions.push(action)
  }

  return { schemaVersion, templateId, templateVersion, allowedActions }
}

function loadContract(): TemplateContract | null {
  const contractPath = readContractPath()
  if (cacheContract && cachePath === contractPath) return cacheContract

  try {
    const text = readFileSync(contractPath, 'utf8')
    const parsed = parseContract(JSON.parse(text))
    cachePath = contractPath
    cacheContract = parsed
    return parsed
  } catch {
    cachePath = contractPath
    cacheContract = null
    return null
  }
}

export function getTemplateContractAction(actionName: string): TemplateContractAction | null {
  const contract = loadContract()
  if (!contract) return null
  return contract.allowedActions.find((action) => action.name === actionName) || null
}

export function resetTemplateContractCacheForTests() {
  cachePath = ''
  cacheContract = null
}
