import fs from 'node:fs';
import path from 'node:path';

import { loadAuthConfig, type AuthConfig } from './config';
import type { TelemetryReporter } from './telemetry';

export interface SecurityCheckResult {
  name: string;
  ok: boolean;
  details?: string;
  severity?: 'info' | 'warn' | 'error';
}

export interface RunSecurityChecksOptions {
  config?: AuthConfig;
  telemetry?: TelemetryReporter;
  probeHealth?: boolean;
  fetcher?: typeof fetch;
}

export async function runSecurityChecks(options: RunSecurityChecksOptions = {}): Promise<SecurityCheckResult[]> {
  const config = options.config ?? loadAuthConfig();
  const results: SecurityCheckResult[] = [];

  results.push(checkBaseUrl(config.baseUrl));
  results.push(checkTimeout(config.timeoutMs));
  results.push(checkClientSecret(config.clientSecret));
  results.push(...checkTelemetryTargets(config.telemetry));
  results.push(...checkIntegrations(config.integrations));

  if (options.probeHealth !== false) {
    results.push(await probeHealthEndpoint(config.baseUrl, options.fetcher));
  }

  if (options.telemetry) {
    for (const result of results) {
      options.telemetry.emit({ action: 'security-check', ok: result.ok, meta: { name: result.name, severity: result.severity, details: result.details } });
    }
  }

  return results;
}

function checkBaseUrl(baseUrl: string): SecurityCheckResult {
  try {
    const parsed = new URL(baseUrl);
    const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.hostname.endsWith('.local');
    if (parsed.protocol !== 'https:' && !isLocal) {
      return { name: 'base-url', ok: false, severity: 'warn', details: `Base URL ${baseUrl} is not HTTPS.` };
    }
    return { name: 'base-url', ok: true, details: `Resolved to ${parsed.hostname}` };
  } catch (error) {
    return { name: 'base-url', ok: false, severity: 'error', details: `Invalid URL (${(error as Error).message})` };
  }
}

function checkTimeout(timeoutMs: number): SecurityCheckResult {
  if (timeoutMs < 2000 || timeoutMs > 60000) {
    return { name: 'timeout', ok: false, severity: 'warn', details: 'Timeout should be between 2000 and 60000 milliseconds.' };
  }
  return { name: 'timeout', ok: true };
}

function checkClientSecret(secret?: string): SecurityCheckResult {
  if (!secret) {
    return { name: 'client-secret', ok: false, severity: 'warn', details: 'clientSecret missing; CLI workflows may fail.' };
  }
  if (secret.length < 12) {
    return { name: 'client-secret', ok: false, severity: 'warn', details: 'clientSecret is shorter than 12 characters.' };
  }
  return { name: 'client-secret', ok: true };
}

function checkTelemetryTargets(telemetry: AuthConfig['telemetry']): SecurityCheckResult[] {
  return [telemetry.filePath, telemetry.metricsFile].map((target, index) => {
    const label = index === 0 ? 'telemetry-file' : 'metrics-file';
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const handle = fs.openSync(target, 'a');
      fs.closeSync(handle);
      return { name: label, ok: true, details: target };
    } catch (error) {
      return { name: label, ok: false, severity: 'warn', details: `Cannot access ${target}: ${(error as Error).message}` };
    }
  });
}

function checkIntegrations(integrations: Record<string, string>): SecurityCheckResult[] {
  return Object.entries(integrations).map(([name, target]) => {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      return { name: `integration.${name}`, ok: target.startsWith('https://'), severity: target.startsWith('https://') ? undefined : 'warn', details: target } satisfies SecurityCheckResult;
    }

    if (fs.existsSync(target)) {
      return { name: `integration.${name}`, ok: true, details: target };
    }

    return { name: `integration.${name}`, ok: false, severity: 'warn', details: `${target} missing` };
  });
}

async function probeHealthEndpoint(baseUrl: string, fetcher?: typeof fetch): Promise<SecurityCheckResult> {
  const client = fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const url = `${baseUrl.replace(/\/$/, '')}/health/auth`;
  try {
    const response = await client(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
    if (response.ok) {
      return { name: 'health-probe', ok: true, details: 'Auth health endpoint is reachable.' };
  }
    return { name: 'health-probe', ok: false, severity: 'warn', details: `Status ${response.status}` };
  } catch (error) {
    return { name: 'health-probe', ok: false, severity: 'warn', details: `Probe failed (${(error as Error).message})` };
  } finally {
    clearTimeout(timeout);
  }
}
