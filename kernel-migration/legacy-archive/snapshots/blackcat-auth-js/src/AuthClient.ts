import { TelemetryReporter, type TelemetryOptions } from './telemetry';

export interface TokenPair {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface AuthClientOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  fetcher?: typeof fetch;
  telemetry?: TelemetryReporter | TelemetryOptions;
  timeoutMs?: number;
}

export class AuthClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetcher: typeof fetch;
  private readonly telemetry?: TelemetryReporter;
  private readonly timeoutMs: number;

  constructor(opts: AuthClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'blackcat-auth-js',
      ...(opts.defaultHeaders ?? {}),
    };
    this.fetcher = opts.fetcher ?? fetch;
    this.telemetry = opts.telemetry instanceof TelemetryReporter ? opts.telemetry : opts.telemetry ? new TelemetryReporter(opts.telemetry) : undefined;
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  async passwordGrant(username: string, password: string): Promise<TokenPair> {
    return this.post<TokenPair>('/login', { username, password });
  }

  async token(body: Record<string, unknown>): Promise<TokenPair> {
    return this.post<TokenPair>('/token', body);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async clientCredentials(clientId: string, clientSecret: string, scopes: string[] = []): Promise<TokenPair> {
    return this.token({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scopes,
    });
  }

  async userinfo(accessToken: string): Promise<Record<string, unknown>> {
    return this.get('/userinfo', accessToken);
  }

  async deviceCode(clientId: string, scope = 'openid'): Promise<any> {
    return this.post('/device/code', { client_id: clientId, scope });
  }

  async deviceActivate(userCode: string, username: string, password: string): Promise<any> {
    return this.post('/device/activate', { user_code: userCode, username, password });
  }

  async devicePoll(deviceCode: string): Promise<any> {
    return this.post('/device/token', { device_code: deviceCode });
  }

  async requestMagicLink(email: string, redirect?: string): Promise<any> {
    return this.post('/magic-link/request', { email, redirect });
  }

  async consumeMagicLink(token: string): Promise<TokenPair> {
    return this.post('/magic-link/consume', { token });
  }

  async startWebAuthnRegister(accessToken: string): Promise<any> {
    return this.authorizedPost('/webauthn/register/start', accessToken, {});
  }

  async finishWebAuthnRegister(accessToken: string, params: Record<string, unknown>): Promise<any> {
    return this.authorizedPost('/webauthn/register/finish', accessToken, params);
  }

  async startWebAuthnAuth(email: string): Promise<any> {
    return this.post('/webauthn/authenticate/start', { email });
  }

  async finishWebAuthnAuth(params: Record<string, unknown>): Promise<TokenPair> {
    return this.post('/webauthn/authenticate/finish', params);
  }

  async sessions(accessToken: string): Promise<any[]> {
    return this.authorizedGet('/session', accessToken);
  }

  async eventsStream(lastId?: number): Promise<{ last_id: number; events: any[] }> {
    const query = typeof lastId === 'number' ? `?last_id=${lastId}` : '';
    return this.get(`/events/stream${query}`);
  }

  private get<T = any>(path: string, accessToken?: string): Promise<T> {
    return this.request('GET', path, { accessToken });
  }

  private post<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request('POST', path, { body });
  }

  private authorizedPost<T = any>(path: string, accessToken: string, body: Record<string, unknown>): Promise<T> {
    return this.request('POST', path, { accessToken, body });
  }

  private authorizedGet<T = any>(path: string, accessToken: string): Promise<T> {
    return this.request('GET', path, { accessToken });
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: Record<string, unknown>; accessToken?: string },
  ): Promise<T> {
    const url = this.composeUrl(path);
    const headers = options.accessToken ? { ...this.headers, Authorization: `Bearer ${options.accessToken}` } : { ...this.headers };

    const executeRequest = async (): Promise<T> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(url, {
          method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(`AuthClient error ${response.status}: ${message}`);
        }
        return (await response.json()) as T;
      } finally {
        clearTimeout(timeout);
      }
    };

    if (!this.telemetry) {
      return executeRequest();
    }

    return this.telemetry.run(`${method.toUpperCase()} ${path}`, { method: method.toUpperCase(), path }, executeRequest);
  }

  private composeUrl(pathname: string): string {
    return `${this.baseUrl}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  }
}
