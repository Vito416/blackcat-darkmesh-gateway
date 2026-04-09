import type { AuthConfig } from './config';
import { runSecurityChecks, type SecurityCheckResult } from './securityChecks';
import type { TelemetryReporter } from './telemetry';

export interface SecurityAuditOptions {
  telemetry?: TelemetryReporter;
  probeHealth?: boolean;
}

export class SecurityAuditor {
  constructor(private readonly config: AuthConfig) {}

  async run(options: SecurityAuditOptions = {}): Promise<SecurityCheckResult[]> {
    return runSecurityChecks({ config: this.config, telemetry: options.telemetry, probeHealth: options.probeHealth });
  }

  async assertSafe(options: SecurityAuditOptions = {}): Promise<void> {
    const results = await this.run(options);
    const failing = results.filter((result) => !result.ok && result.severity !== 'info');
    if (failing.length > 0) {
      const message = failing.map((result) => `${result.name}: ${result.details ?? 'failed'}`).join('; ');
      throw new Error(`Security checks failed: ${message}`);
    }
  }
}
