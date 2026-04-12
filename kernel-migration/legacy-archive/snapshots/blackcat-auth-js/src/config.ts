import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type WorkflowType = 'password_grant' | 'client_credentials' | 'magic_link' | 'device_code';

export interface WorkflowScenario {
  id: string;
  type: WorkflowType;
  description?: string;
  params?: Record<string, string>;
}

export interface ConfigProfileRef {
  file?: string;
  name?: string;
  environment?: string;
  env?: Record<string, string>;
}

export interface TelemetryConfig {
  filePath: string;
  metricsFile: string;
  tailLimit: number;
}

export interface AuthConfig {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  timeoutMs: number;
  defaultHeaders: Record<string, string>;
  defaultScopes: string[];
  telemetry: TelemetryConfig;
  integrations: Record<string, string>;
  workflows: WorkflowScenario[];
  profile?: ConfigProfileRef;
  metadata: {
    configPath: string;
    resolvedFromExample: boolean;
    profileEnv: Record<string, string>;
  };
}

interface RawConfig {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
  defaultScopes?: string[];
  telemetry?: Partial<Omit<TelemetryConfig, 'filePath' | 'metricsFile'>> & {
    filePath?: string;
    metricsFile?: string;
  };
  integrations?: Record<string, string>;
  workflows?: WorkflowScenario[];
  profile?: ConfigProfileRef;
}

export interface LoadAuthConfigOptions {
  configPath?: string;
  env?: Record<string, string | undefined>;
  overrides?: Partial<RawConfig>;
}

const DEFAULT_LOCAL = path.resolve(process.cwd(), 'config', 'auth.local.json');
const DEFAULT_EXAMPLE = path.resolve(process.cwd(), 'config', 'auth.example.json');

export function resolveConfigPath(input?: string): string {
  if (input && fs.existsSync(path.resolve(input))) {
    return path.resolve(input);
  }

  const envPath = process.env.BLACKCAT_AUTH_CONFIG;
  if (envPath && fs.existsSync(path.resolve(envPath))) {
    return path.resolve(envPath);
  }

  if (fs.existsSync(DEFAULT_LOCAL)) {
    return DEFAULT_LOCAL;
  }

  if (fs.existsSync(DEFAULT_EXAMPLE)) {
    return DEFAULT_EXAMPLE;
  }

  throw new Error('No auth config file found. Create config/auth.local.json or config/auth.example.json.');
}

export function loadAuthConfig(options: LoadAuthConfigOptions = {}): AuthConfig {
  const envSource = options.env ?? process.env;
  const configPath = options.configPath ? path.resolve(options.configPath) : resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  const baseDir = path.dirname(configPath);
  const rawPayload = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RawConfig;
  const profileTemplate = rawPayload.profile ? expandPlaceholders(rawPayload.profile, baseDir, envSource, {}) as ConfigProfileRef : undefined;
  const profileEnv = loadProfileEnv(profileTemplate, baseDir);
  const expandedPayload = expandPlaceholders({ ...rawPayload, profile: profileTemplate }, baseDir, envSource, profileEnv) as RawConfig;
  const merged = mergePayload(expandedPayload, options.overrides);
  return normalizeConfig(merged, configPath, baseDir, profileEnv, envSource);
}

function mergePayload(base: RawConfig, overrides?: Partial<RawConfig>): RawConfig {
  if (!overrides) {
    return base;
  }

  const result: RawConfig = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = value.slice();
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      const existing = (result as Record<string, unknown>)[key];
      (result as Record<string, unknown>)[key] = {
        ...(typeof existing === 'object' && existing ? existing : {}),
        ...value,
      };
      continue;
    }

    (result as Record<string, unknown>)[key] = value;
  }

  return result;
}

function normalizeConfig(
  payload: RawConfig,
  configPath: string,
  baseDir: string,
  profileEnv: Record<string, string>,
  envSource: Record<string, string | undefined>,
): AuthConfig {
  const baseUrl = normalizeBaseUrl(payload.baseUrl ?? envSource.BLACKCAT_AUTH_BASE_URL ?? 'https://localhost:9443');
  const clientId = payload.clientId ?? envSource.BLACKCAT_AUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error('clientId must be configured via config file or BLACKCAT_AUTH_CLIENT_ID');
  }

  const defaultHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'blackcat-auth-js',
    ...(payload.defaultHeaders ?? {}),
  };

  const defaultScopes = (payload.defaultScopes ?? ['openid']).filter((scope) => scope.length > 0);

  const telemetry = {
    filePath: path.resolve(baseDir, payload.telemetry?.filePath ?? '../var/log/auth-cli.ndjson'),
    metricsFile: path.resolve(baseDir, payload.telemetry?.metricsFile ?? '../var/metrics/auth-cli.prom'),
    tailLimit: payload.telemetry?.tailLimit ?? 50,
  } satisfies TelemetryConfig;

  const integrations = Object.entries(payload.integrations ?? defaultIntegrations())
    .reduce<Record<string, string>>((acc, [name, target]) => {
      acc[name] = target.startsWith('http://') || target.startsWith('https://')
        ? target
        : path.resolve(baseDir, target);
      return acc;
    }, {});

  const profile = payload.profile
    ? {
        ...payload.profile,
        file: payload.profile.file ? path.resolve(baseDir, payload.profile.file) : undefined,
        env: profileEnv,
      }
    : undefined;

  const workflows = normalizeWorkflows(payload.workflows ?? defaultWorkflows(envSource, defaultScopes));

  return {
    baseUrl,
    clientId,
    clientSecret: payload.clientSecret ?? envSource.BLACKCAT_AUTH_CLIENT_SECRET,
    timeoutMs: payload.timeoutMs ?? 5000,
    defaultHeaders,
    defaultScopes,
    telemetry,
    integrations,
    workflows,
    profile,
    metadata: {
      configPath,
      resolvedFromExample: configPath.endsWith('auth.example.json'),
      profileEnv,
    },
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, '');
}

function defaultIntegrations(): Record<string, string> {
  return {
    database: '../blackcat-cli/bin/dbctl',
    orchestrator: '../blackcat-orchestrator/bin/orchestrator',
    config: '../blackcat-cli/bin/config',
  };
}

function normalizeWorkflows(workflows: WorkflowScenario[]): WorkflowScenario[] {
  const seen = new Set<string>();
  return workflows
    .map((workflow) => ({
      id: String(workflow.id).trim(),
      type: workflow.type,
      description: workflow.description,
      params: workflow.params ?? {},
    }))
    .filter((workflow) => workflow.id.length > 0 && !!workflow.type)
    .filter((workflow) => {
      if (seen.has(workflow.id)) {
        return false;
      }
      seen.add(workflow.id);
      return true;
    });
}

function defaultWorkflows(envSource: Record<string, string | undefined>, scopes: string[]): WorkflowScenario[] {
  const username = envSource.BLACKCAT_AUTH_USERNAME ?? 'demo@blackcat.local';
  const password = envSource.BLACKCAT_AUTH_PASSWORD ?? 'secret';
  return [
    {
      id: 'password-demo',
      type: 'password_grant',
      description: 'Validate username/password grant against the seeded demo account.',
      params: { username, password },
    },
    {
      id: 'client-credentials-default',
      type: 'client_credentials',
      description: 'Smoke test service-to-service handshake.',
      params: { scopes: scopes.join(',') },
    },
    {
      id: 'magic-link-demo',
      type: 'magic_link',
      description: 'Send a passwordless login link to the console team.',
      params: { email: envSource.BLACKCAT_AUTH_MAGIC_EMAIL ?? 'developer@blackcat.local' },
    },
    {
      id: 'device-code-demo',
      type: 'device_code',
      description: 'Exercise device-code bootstrap for headless agents.',
      params: { interval: '5' },
    },
  ];
}

function expandPlaceholders<T>(value: T, baseDir: string, envSource: Record<string, string | undefined>, profileEnv: Record<string, string>): T {
  if (Array.isArray(value)) {
    return value.map((entry) => expandPlaceholders(entry, baseDir, envSource, profileEnv)) as T;
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = expandPlaceholders(entry, baseDir, envSource, profileEnv);
    }
    return output as T;
  }

  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(/\$\{(env|file):([^}|]+)(?:\|([^}]+))?}/g, (_, type: string, reference: string, fallback: string | undefined) => {
    if (type === 'env') {
      const resolved = profileEnv[reference] ?? envSource[reference];
      if (resolved !== undefined && resolved !== '') {
        return resolved;
      }
      return fallback ?? '';
    }

    const targetPath = reference.startsWith('/') ? reference : path.resolve(baseDir, reference);
    if (!fs.existsSync(targetPath)) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`Config referenced file ${targetPath} but it does not exist`);
    }
    return fs.readFileSync(targetPath, 'utf8').trim();
  }) as T;
}

function loadProfileEnv(profile: ConfigProfileRef | undefined, baseDir: string): Record<string, string> {
  if (!profile?.file) {
    return {};
  }

  const filePath = path.resolve(baseDir, profile.file);
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const escaped = filePath.replace(/'/g, "\\'");
    const script = `\$data = include '${escaped}'; if (!is_array(\$data)) { \$data = []; } echo json_encode(\$data);`;
    const result = spawnSync('php', ['-r', script], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout) {
      return {};
    }

    const decoded = JSON.parse(result.stdout) as Record<string, any>;
    const profiles = decoded.profiles ?? decoded;
    const candidates: Array<Record<string, any>> = [];
    if (profiles && typeof profiles === 'object') {
      for (const [name, profileConfig] of Object.entries(profiles)) {
        candidates.push({ name, ...(profileConfig as Record<string, any>) });
      }
    }

    const match = candidates.find((entry) => {
      if (profile.name && entry.name === profile.name) {
        return true;
      }
      if (profile.environment && entry.environment === profile.environment) {
        return true;
      }
      return false;
    }) ?? candidates[0];

    if (match?.env && typeof match.env === 'object') {
      const envValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(match.env)) {
        envValues[key] = String(value);
      }
      return envValues;
    }
  } catch {
    return {};
  }

  return {};
}
