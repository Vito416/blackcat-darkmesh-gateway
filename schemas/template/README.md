# Template backend schemas

These schemas back the contract references in `config/template-backend-contract.json`.

They are intentionally transport-oriented:
- request schemas describe payloads accepted by `/template/call`
- response schemas describe normalized backend envelopes returned to gateway

For strict domain validation, keep runtime validators in `src/runtime/template/validators.ts`
as the primary enforcement layer and treat these JSON schemas as contract docs + CI anchors.

Current action schema pairs:
- `public.resolve-route` -> `public.resolve-route.request.json`, `public.resolve-route.response.json`
- `public.site-by-host` -> `public.site-by-host.request.json`, `public.site-by-host.response.json`
- `public.get-page` -> `public.get-page.request.json`, `public.get-page.response.json`
- `checkout.create-order` -> `checkout.create-order.request.json`, `checkout.create-order.response.json`
- `checkout.create-payment-intent` -> `checkout.create-payment-intent.request.json`, `checkout.create-payment-intent.response.json`
