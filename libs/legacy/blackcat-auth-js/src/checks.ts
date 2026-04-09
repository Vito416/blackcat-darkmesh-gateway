import fs from 'fs';
import path from 'path';

import type { AuthConfig } from './config';

export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
}

export interface CheckSuite {
  passed: boolean;
  results: CheckResult[];
}

const REQUIRED_TRUSTED_MODULES = ['blackcat-auth', 'blackcat-orchestrator'];

export function runChecks(config: AuthConfig): CheckSuite {
  const results: CheckResult[] = [];

  results.push(checkBaseUrl(config));
  results.push(...checkTelemetry(config));
  results.push(...checkIntegrations(config));
  if (config.profile && config.profileMeta) {
    results.push(checkProfile(config));
  }
  results.push(checkTrustedModules(config));

  return {
    passed: results.every((result) => result.status !== 'fail'),
    results,
  };
}

function checkBaseUrl(config: AuthConfig): CheckResult {
  const policy = config.security ?? {};
  try {
    const url = new URL(config.baseUrl);
    const isHttps = url.protocol === 'https:';
    const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname) || url.hostname.endsWith('.local');

    if (policy.requireHttps !== false && !isHttps && !(isLocal && policy.allowLocalhost)) {
      return {
        name: 'auth.baseUrl.protocol',
        status: 'fail',
        message: `${config.baseUrl} does not use https and local URLs are not allowed`,
        remediation: 'Update auth.baseUrl to https:// or enable allowLocalhost for development use only.',
      };
    }

    return {
      name: 'auth.baseUrl.protocol',
      status: 'pass',
      message: `${config.baseUrl} satisfies security policy`,
    };
  } catch (error) {
    return {
      name: 'auth.baseUrl.protocol',
      status: 'fail',
      message: `Invalid baseUrl ${config.baseUrl}: ${(error as Error).message}`,
      remediation: 'Ensure auth.baseUrl is a valid URL (e.g., https://auth.local.test) before running CLI commands.',
    };
  }
}

function checkTelemetry(config: AuthConfig): CheckResult[] {
  const entries: CheckResult[] = [];
  entries.push(assertWritable(config.telemetry.filePath, 'telemetry.eventsFile'));
  entries.push(assertWritable(config.telemetry.metricsFile, 'telemetry.metricsFile'));
  if (config.telemetry.observabilityBridge) {
    entries.push(assertWritable(config.telemetry.observabilityBridge, 'telemetry.observabilityBridge', false));
  }
  return entries;
}

function checkIntegrations(config: AuthConfig): CheckResult[] {
  const entries: CheckResult[] = [];
  for (const [name, target] of Object.entries(config.integrations)) {
    if (fs.existsSync(target)) {
      entries.push({
        name: `integration.${name}`,
        status: 'pass',
        message: `${name} located at ${target}`,
      });
      continue;
    }

    entries.push({
      name: `integration.${name}`,
      status: 'fail',
      message: `${name} target ${target} is missing`,
      remediation: `Install or clone ${name} next to blackcat-auth-js so the CLI can hand off workflows.`,
    });
  }
  return entries;
}

function checkProfile(config: AuthConfig): CheckResult {
  if (!config.profile?.file) {
    return {
      name: 'config.profile',
      status: 'warn',
      message: 'No profile specified; CLI will rely on defaults.',
      remediation: 'Point profile.file to blackcat-config/profiles.php to inherit project env.',
    };
  }

  if (!fs.existsSync(config.profile.file)) {
    return {
      name: 'config.profile',
      status: 'fail',
      message: `Profile file ${config.profile.file} does not exist`,
      remediation: 'Run blackcat-config Stage 1 setup or update profile.file in config/auth.json.',
    };
  }

  return {
    name: 'config.profile',
    status: 'pass',
    message: `Profile ${config.profile.name ?? 'default'} resolved from ${config.profile.file}`,
  };
}

function checkTrustedModules(config: AuthConfig): CheckResult {
  const trusted = config.security?.trustedModules ?? [];
  const missing = REQUIRED_TRUSTED_MODULES.filter((module) => !trusted.includes(module));
  if (missing.length === 0) {
    return {
      name: 'security.trustedModules',
      status: 'pass',
      message: 'All required modules are present in security.trustedModules',
    };
  }

  return {
    name: 'security.trustedModules',
    status: 'fail',
    message: `Missing trusted modules: ${missing.join(', ')}`,
    remediation: 'Extend security.trustedModules to include core systems that receive tokens.',
  };
}

function assertWritable(filePath: string, label: string, createIfMissing = true): CheckResult {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (createIfMissing) {
      const handle = fs.openSync(filePath, 'a');
      fs.closeSync(handle);
    } else {
      fs.accessSync(path.dirname(filePath), fs.constants.W_OK);
      if (fs.existsSync(filePath)) {
        fs.accessSync(filePath, fs.constants.W_OK);
      }
    }
    return {
      name: label,
      status: 'pass',
      message: `${filePath} is writable`,
    };
  } catch (error) {
    return {
      name: label,
      status: 'fail',
      message: `Cannot write to ${filePath}: ${(error as Error).message}`,
      remediation: 'Ensure the CLI has permission to write telemetry files (var/log + var/metrics).',
    };
  }
}
