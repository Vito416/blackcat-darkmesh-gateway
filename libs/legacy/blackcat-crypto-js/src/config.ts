import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type WorkflowType = 'encryption' | 'signature';

export interface WorkflowDefinition {
  id: string;
  type: WorkflowType;
  context?: string;
  slot?: string;
  payload?: string;
  description?: string;
}

export interface ConfigProfileRef {
  file?: string;
  name?: string;
  environment?: string;
}

export interface LoadedProfile extends ConfigProfileRef {
  env: Record<string, string>;
  status: 'loaded' | 'missing' | 'unverified';
  message?: string;
}

interface ProfileEnvResult extends Record<string, string> {
  __status?: 'loaded' | 'missing' | 'unverified';
  __message?: string;
}

export interface TelemetrySettings {
  eventsFile: string;
  metricsFile: string;
  observabilityBridge?: string;
  tailLimit: number;
}

export interface CryptoConfig {
  configPath: string;
  baseDir: string;
  resolvedFromExample: boolean;
  defaultContext: string;
  allowedContexts: string[];
  metadata: Record<string, unknown>;
  telemetry: TelemetrySettings;
  security: {
    requireTls: boolean;
    requiredIntegrations: string[];
    requireContexts: string[];
  };
  integrations: Record<string, string>;
  workflows: WorkflowDefinition[];
  profile?: LoadedProfile;
  hmacSlots: Record<string, string>;
  encryptionKey: Uint8Array;
  encryptionKeyPreview: string;
  loading: {
    loadedAt: string;
    profileEnv: Record<string, string>;
  };
}

interface RawTelemetrySettings {
  eventsFile?: string;
  metricsFile?: string;
  observabilityBridge?: string;
  tailLimit?: number;
}

interface RawConfig {
  configProfile?: ConfigProfileRef;
  envelope?: {
    defaultContext?: string;
    allowedContexts?: string[];
    metadata?: Record<string, unknown>;
  };
  keys?: {
    encryptionKey?: string;
    encryptionKeyFile?: string;
    hmacSlots?: Record<string, string>;
  };
  telemetry?: RawTelemetrySettings;
  integrations?: Record<string, string>;
  workflows?: WorkflowDefinition[];
  security?: {
    requireTls?: boolean;
    requiredIntegrations?: string[];
    requireContexts?: string[];
  };
}

export interface LoadOptions {
  configPath?: string;
  env?: Record<string, string | undefined>;
}

const CONFIG_LOCATIONS = [
  path.resolve(process.cwd(), 'config', 'crypto.local.json'),
  path.resolve(process.cwd(), 'config', 'crypto.example.json'),
];

export function resolveConfigPath(explicit?: string): string {
  if (explicit) {
    const candidate = path.resolve(explicit);
    if (!fs.existsSync(candidate)) {
      throw new Error(`Config file ${candidate} does not exist`);
    }
    return candidate;
  }

  const envPath = process.env.BLACKCAT_CRYPTO_CONFIG;
  if (envPath) {
    const candidate = path.resolve(envPath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const candidate of CONFIG_LOCATIONS) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate config file (expected config/crypto.local.json or config/crypto.example.json)');
}

export function loadCryptoConfig(options: LoadOptions = {}): CryptoConfig {
  const envSource = options.env ?? process.env;
  const configPath = resolveConfigPath(options.configPath);
  const baseDir = path.dirname(configPath);
  const rawPayload = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RawConfig;

  const expandedProfile = rawPayload.configProfile
    ? (expandPlaceholders(rawPayload.configProfile, baseDir, envSource, {}) as ConfigProfileRef)
    : undefined;
  const profileEnv = loadProfileEnv(expandedProfile, baseDir);
  const payload = expandPlaceholders({ ...rawPayload, configProfile: expandedProfile }, baseDir, envSource, profileEnv) as RawConfig;

  const telemetry = normalizeTelemetry(payload.telemetry, baseDir);
  const defaultContext = payload.envelope?.defaultContext ?? 'pii';
  const allowedContexts = payload.envelope?.allowedContexts ?? [defaultContext];
  const integrations = normalizeIntegrations(payload.integrations ?? {}, baseDir);
  const security = {
    requireTls: payload.security?.requireTls ?? true,
    requiredIntegrations: payload.security?.requiredIntegrations ?? Object.keys(integrations),
    requireContexts: payload.security?.requireContexts ?? [defaultContext],
  };

  const workflows = normalizeWorkflows(payload.workflows ?? [], defaultContext);
  const hmacSlots = normalizeSlots(payload.keys?.hmacSlots ?? {});
  const encryptionKeySource = resolveEncryptionKey(payload.keys, baseDir);
  if (!encryptionKeySource) {
    throw new Error('Encryption key missing. Configure keys.encryptionKey or keys.encryptionKeyFile.');
  }

  const encryptionKey = decodeKeyMaterial(encryptionKeySource);

  const profileEnvClean: Record<string, string> = { ...profileEnv };
  delete profileEnvClean.__status;
  delete profileEnvClean.__message;

  const profile = expandedProfile
    ? {
        ...expandedProfile,
        env: profileEnvClean,
        status: profileEnv.__status ?? 'loaded',
        message: profileEnv.__message,
      }
    : undefined;

  return {
    configPath,
    baseDir,
    resolvedFromExample: configPath.endsWith('crypto.example.json'),
    defaultContext,
    allowedContexts,
    metadata: payload.envelope?.metadata ?? {},
    telemetry,
    security,
    integrations,
    workflows,
    profile,
    hmacSlots,
    encryptionKey,
    encryptionKeyPreview: Buffer.from(encryptionKey).toString('base64url').slice(0, 12),
    loading: {
      loadedAt: new Date().toISOString(),
      profileEnv: profileEnvClean,
    },
  };
}

function normalizeTelemetry(settings: RawTelemetrySettings | undefined, baseDir: string): TelemetrySettings {
  const eventsFile = path.resolve(baseDir, settings?.eventsFile ?? '../var/log/crypto-js.ndjson');
  const metricsFile = path.resolve(baseDir, settings?.metricsFile ?? '../var/metrics/crypto-js.prom');
  const observabilityBridge = settings?.observabilityBridge
    ? path.resolve(baseDir, settings.observabilityBridge)
    : undefined;
  return {
    eventsFile,
    metricsFile,
    observabilityBridge,
    tailLimit: settings?.tailLimit ?? 20,
  };
}

function normalizeIntegrations(entries: Record<string, string>, baseDir: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, target] of Object.entries(entries)) {
    output[name] = target.startsWith('http://') || target.startsWith('https://')
      ? target
      : path.resolve(baseDir, target);
  }
  return output;
}

function normalizeWorkflows(workflows: WorkflowDefinition[], defaultContext: string): WorkflowDefinition[] {
  const seen = new Set<string>();
  return workflows
    .map((workflow) => ({
      ...workflow,
      id: workflow.id?.trim(),
      context: workflow.context ?? defaultContext,
    }))
    .filter((workflow) => Boolean(workflow.id && workflow.type))
    .filter((workflow) => {
      if (seen.has(workflow.id!)) {
        return false;
      }
      seen.add(workflow.id!);
      return true;
    }) as WorkflowDefinition[];
}

function normalizeSlots(slots: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, secret] of Object.entries(slots)) {
    if (!secret) {
      continue;
    }
    normalized[name] = secret;
  }
  return normalized;
}

function resolveEncryptionKey(keys: RawConfig['keys'], baseDir: string): string | undefined {
  if (!keys) {
    return undefined;
  }
  if (keys.encryptionKey) {
    return keys.encryptionKey;
  }
  if (keys.encryptionKeyFile) {
    const absolute = path.isAbsolute(keys.encryptionKeyFile)
      ? keys.encryptionKeyFile
      : path.resolve(baseDir, keys.encryptionKeyFile);
    if (fs.existsSync(absolute)) {
      return fs.readFileSync(absolute, 'utf8').trim();
    }
  }
  return undefined;
}

function decodeKeyMaterial(input: string): Uint8Array {
  try {
    return Uint8Array.from(Buffer.from(input, 'base64url'));
  } catch {
    return new TextEncoder().encode(input);
  }
}

type PlaceholderContext = Record<string, string | undefined>;

function expandPlaceholders<T>(value: T, baseDir: string, env: PlaceholderContext, profileEnv: ProfileEnvResult): T {
  if (Array.isArray(value)) {
    return value.map((entry) => expandPlaceholders(entry, baseDir, env, profileEnv)) as T;
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = expandPlaceholders(entry, baseDir, env, profileEnv);
    }
    return next as T;
  }

  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(/\$\{(env|file):([^}|]+)(?:\|([^}]+))?}/g, (_match, type: string, reference: string, fallback?: string) => {
    if (type === 'env') {
      const envValue = profileEnv[reference] ?? env[reference];
      if (envValue !== undefined && envValue !== '') {
        return envValue;
      }
      return fallback ?? '';
    }

    const attempts = [reference];
    if (fallback) {
      attempts.push(fallback);
    }

    for (const attempt of attempts) {
      const targetPath = attempt.startsWith('/') ? attempt : path.resolve(baseDir, attempt);
      if (fs.existsSync(targetPath)) {
        return fs.readFileSync(targetPath, 'utf8').trim();
      }
    }

    return fallback ?? '';
  }) as T;
}

function loadProfileEnv(profile: ConfigProfileRef | undefined, baseDir: string): ProfileEnvResult {
  if (!profile?.file) {
    return {};
  }

  const filePath = path.isAbsolute(profile.file) ? profile.file : path.resolve(baseDir, profile.file);
  if (!fs.existsSync(filePath)) {
    return { __status: 'missing', __message: `Profile file ${filePath} not found` };
  }

  try {
    const escaped = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const script = `<?php $data = include '${escaped}'; if (!is_array($data)) { $data = []; } echo json_encode($data);`;
    const result = spawnSync('php', ['-r', script], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout) {
      throw new Error(result.stderr?.toString().trim() || 'php returned non-zero status');
    }

    const payload = JSON.parse(result.stdout) as { profiles?: Record<string, any>; defaults?: Record<string, any> };
    const profiles = payload.profiles ?? {};
    const candidates = Object.entries(profiles).map(([name, data]) => ({ name, ...(data as Record<string, unknown>) }));
    let matched = candidates.find((item) => item.name === profile.name);
    if (!matched && profile.environment) {
      matched = candidates.find((item) => item.environment === profile.environment);
    }

    if (!matched && candidates.length > 0) {
      matched = candidates[0];
    }

    const env = matched?.env ?? {};
    const normalized: ProfileEnvResult = {};
    for (const [key, value] of Object.entries(env)) {
      normalized[String(key)] = String(value);
    }
    normalized.__status = 'loaded';
    return normalized;
  } catch (error) {
    return {
      __status: 'unverified',
      __message: error instanceof Error ? error.message : String(error),
    };
  }
}
