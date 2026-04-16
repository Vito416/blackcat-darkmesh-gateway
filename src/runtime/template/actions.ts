import {
  validateCreateOrder,
  validateCreatePaymentIntent,
  validateGetPage,
  validateSiteByHost,
  validateResolveRoute,
} from './validators.js'

export type BackendTarget = 'ao' | 'write' | 'worker'
type ActionKind = 'read' | 'write'

export type TemplateActionPolicy = {
  action: string
  kind: ActionKind
  target: BackendTarget
  path: string
  method: 'POST'
  validate: (payload: unknown) => { ok: true } | { ok: false; error: string }
}

export const templateActionPolicies: TemplateActionPolicy[] = [
  {
    action: 'public.resolve-route',
    kind: 'read',
    target: 'ao',
    path: '/api/public/resolve-route',
    method: 'POST',
    validate: validateResolveRoute,
  },
  {
    action: 'public.site-by-host',
    kind: 'read',
    target: 'ao',
    path: '/api/public/site-by-host',
    method: 'POST',
    validate: validateSiteByHost,
  },
  {
    action: 'public.get-page',
    kind: 'read',
    target: 'ao',
    path: '/api/public/page',
    method: 'POST',
    validate: validateGetPage,
  },
  {
    action: 'checkout.create-order',
    kind: 'write',
    target: 'write',
    path: '/api/checkout/order',
    method: 'POST',
    validate: validateCreateOrder,
  },
  {
    action: 'checkout.create-payment-intent',
    kind: 'write',
    target: 'write',
    path: '/api/checkout/payment-intent',
    method: 'POST',
    validate: validateCreatePaymentIntent,
  },
]

export function getTemplateActionPolicy(action: string): TemplateActionPolicy | undefined {
  return templateActionPolicies.find((policy) => policy.action === action)
}
