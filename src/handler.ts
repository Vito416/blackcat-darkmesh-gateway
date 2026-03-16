/**
 * Gateway skeleton
 * - Verify template manifest, serve cached bundle
 * - Proxy API to Write AO / AO
 * - PSP webhook ingress with signature check
 * - Envelope cache (TTL) for encrypted blobs
 */

export async function handleRequest(request: Request): Promise<Response> {
  // TODO: route based on pathname
  return new Response("Gateway skeleton", { status: 200 });
}
