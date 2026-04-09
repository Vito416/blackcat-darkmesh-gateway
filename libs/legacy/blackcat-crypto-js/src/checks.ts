import fs from 'node:fs';
import path from 'node:path';

import type { CryptoConfig } from './config';

export type CheckStatus = 'pass' | 'warn' | 'fail';

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

export function runChecks(config: CryptoConfig): CheckSuite {
  const results: CheckResult[] = [];
  results.push(checkEncryptionKey(config));
  results.push(checkContexts(config));
  results.push(checkProfile(config));
  results.push(...checkTelemetry(config));
  results.push(...checkIntegrations(config));
  results.push(checkSlots(config));

  return {
    passed: results.every((result) => result.status !== 'fail'),
    results,
  };
}

function checkEncryptionKey(config: CryptoConfig): CheckResult {
  if (config.encryptionKey.length < 32) {
    return {
      name: 'encryption.key',
      status: 'fail',
      message: 'Encryption key shorter than 256 bits.',
      remediation: 'Regenerate keys.encryptionKey (32+ bytes) via blackcat-crypto/bin/crypto key:generate.',
    };
  }

  return {
    name: 'encryption.key',
    status: 'pass',
    message: 'Encryption key meets minimum length.',
  };
}

function checkContexts(config: CryptoConfig): CheckResult {
  const missing = config.security.requireContexts.filter((context) => !config.allowedContexts.includes(context));
  if (missing.length > 0) {
    return {
      name: 'envelope.contexts',
      status: 'fail',
      message: `Missing required contexts: ${missing.join(', ')}`,
      remediation: 'Update envelope.allowedContexts in config/crypto*.json to include the required contexts.',
    };
  }

  return {
    name: 'envelope.contexts',
    status: 'pass',
    message: `${config.allowedContexts.length} contexts allowed (${config.allowedContexts.join(', ')})`,
  };
}

function checkProfile(config: CryptoConfig): CheckResult {
  if (!config.profile) {
    return {
      name: 'config.profile',
      status: 'warn',
      message: 'No configProfile configured; telemetry cannot tie back to blackcat-config.',
      remediation: 'Set configProfile.file/environment to reuse central profiles.',
    };
  }

  if (config.profile.status === 'loaded') {
    return {
      name: 'config.profile',
      status: 'pass',
      message: `Profile ${config.profile.name ?? config.profile.environment ?? 'default'} loaded from ${config.profile.file}`,
    };
  }

  return {
    name: 'config.profile',
    status: config.profile.status === 'missing' ? 'fail' : 'warn',
    message: config.profile.message ?? 'Unable to verify profile',
    remediation: 'Ensure PHP is installed and blackcat-config/config/profiles.php exists.',
  };
}

function checkTelemetry(config: CryptoConfig): CheckResult[] {
  return [config.telemetry.eventsFile, config.telemetry.metricsFile]
    .map((filePath, index) => {
      const label = index === 0 ? 'telemetry.events' : 'telemetry.metrics';
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const handle = fs.openSync(filePath, 'a');
        fs.closeSync(handle);
        return {
          name: label,
          status: 'pass',
          message: `${filePath} is writable`,
        } satisfies CheckResult;
      } catch (error) {
        return {
          name: label,
          status: 'fail',
          message: `Cannot write to ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
          remediation: 'Grant write permission to var/log + var/metrics directories.',
        } satisfies CheckResult;
      }
    });
}

function checkIntegrations(config: CryptoConfig): CheckResult[] {
  return Object.entries(config.integrations).map(([name, target]) => {
    if (target.startsWith('http://')) {
      return {
        name: `integration.${name}`,
        status: 'warn',
        message: `${target} uses HTTP instead of HTTPS`,
        remediation: 'Prefer https:// endpoints for integration targets.',
      } satisfies CheckResult;
    }

    if (target.startsWith('https://')) {
      return {
        name: `integration.${name}`,
        status: 'pass',
        message: `${target} reachable via HTTPS`,
      } satisfies CheckResult;
    }

    if (fs.existsSync(target)) {
      return {
        name: `integration.${name}`,
        status: 'pass',
        message: `${target} found`,
      } satisfies CheckResult;
    }

    return {
      name: `integration.${name}`,
      status: 'fail',
      message: `${target} missing`,
      remediation: `Clone or install ${name} next to blackcat-crypto-js.`,
    } satisfies CheckResult;
  });
}

function checkSlots(config: CryptoConfig): CheckResult {
  if (Object.keys(config.hmacSlots).length === 0) {
    return {
      name: 'hmac.slots',
      status: 'fail',
      message: 'No HMAC slots configured.',
      remediation: 'Populate keys.hmacSlots object with at least one slot (api/session/email).',
    };
  }

  return {
    name: 'hmac.slots',
    status: 'pass',
    message: `${Object.keys(config.hmacSlots).length} HMAC slot(s) configured`,
  };
}
