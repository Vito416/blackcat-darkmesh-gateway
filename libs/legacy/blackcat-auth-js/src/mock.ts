import type { AuthConfig } from './config';

type FetchLike = typeof fetch;

interface MockUser {
  userId: string;
  email: string;
  roles: string[];
  tokenTtl: number;
}

export function createMockFetcher(config: AuthConfig & { mockUser?: MockUser }): FetchLike {
  const mockUser: MockUser = config.mockUser ?? {
    userId: 'user-0',
    email: 'user@example.com',
    roles: ['viewer'],
    tokenTtl: 1800,
  };

  return async (url, init): Promise<Response> => {
    const parsed = typeof url === 'string' ? new URL(url) : new URL(url.url ?? url.toString());
    const path = parsed.pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (path === '/login') {
      return jsonResponse(makeTokens(mockUser, config, body.username));
    }

    if (path === '/token') {
      return jsonResponse(
        makeTokens(
          mockUser,
          config,
          body.client_id ?? config.clientId,
          body.scopes ?? config.defaultScopes,
        ),
      );
    }

    if (path === '/magic-link/request') {
      return jsonResponse({ status: 'sent', email: body.email });
    }

    if (path === '/magic-link/consume') {
      return jsonResponse(makeTokens(mockUser, config, body.token));
    }

    if (path === '/userinfo') {
      return jsonResponse({ sub: mockUser.userId, email: mockUser.email, roles: mockUser.roles });
    }

    if (path === '/session') {
      return jsonResponse([
        { id: 'session-1', status: 'active', user: mockUser.userId },
        { id: 'session-2', status: 'revoked', user: mockUser.userId },
      ]);
    }

    if (path === '/events/stream') {
      return jsonResponse({
        last_id: Date.now(),
        events: [
          { id: Date.now(), type: 'login', metadata: { user: mockUser.userId } },
          { id: Date.now() + 1, type: 'refresh', metadata: { user: mockUser.userId } },
        ],
      });
    }

    if (path === '/device/code') {
      return jsonResponse({
        device_code: 'device-code',
        user_code: 'user-code',
        verification_uri: `${config.baseUrl}/device/verify`,
      });
    }

    if (path === '/device/activate') {
      return jsonResponse({ status: 'activated', code: body.user_code });
    }

    if (path === '/device/token') {
      return jsonResponse(makeTokens(mockUser, config, body.device_code));
    }

    return jsonResponse({ message: `Mock endpoint ${path} not implemented` }, 404);
  };
}

function makeTokens(
  mockUser: MockUser,
  config: AuthConfig,
  subject: string,
  scopes: string[] = config.defaultScopes,
): Record<string, unknown> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + mockUser.tokenTtl;
  return {
    accessToken: encodeToken({ sub: subject ?? mockUser.userId, scopes, exp: expiresAt }),
    refreshToken: encodeToken({ sub: subject ?? mockUser.userId, scopes, type: 'refresh', exp: expiresAt + 3600 }),
    expiresAt,
  };
}

function encodeToken(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
