import fs from 'node:fs';
import path from 'node:path';

import { Counter, Registry } from 'prom-client';

export interface TelemetryOptions {
  eventsFile: string;
  metricsFile: string;
  coverageFile?: string;
  observabilityBridge?: string;
}

export interface TelemetryEvent {
  timestamp: string;
  source: string;
  event: string;
  payload?: Record<string, unknown>;
}

export class Telemetry {
  private readonly registry = new Registry();
  private readonly commandCounter: Counter<string>;
  private coverageEntries: CoverageEntry[] = [];

  constructor(private readonly options: TelemetryOptions) {
    this.ensureDirectory(options.eventsFile);
    this.ensureDirectory(options.metricsFile);
    if (options.coverageFile) {
      this.ensureDirectory(options.coverageFile);
    }
    if (options.observabilityBridge) {
      this.ensureDirectory(options.observabilityBridge);
    }

    this.commandCounter = new Counter({
      name: 'blackcat_crypto_cli_command_total',
      help: 'Number of CLI commands executed via blackcat-crypto-js',
      labelNames: ['command', 'status'],
      registers: [this.registry],
    });
  }

  record(event: string, payload: Record<string, unknown> = {}): void {
    const entry: TelemetryEvent = {
      source: 'blackcat-crypto-js',
      event,
      timestamp: new Date().toISOString(),
      payload,
    };

    const serialized = JSON.stringify(entry);
    fs.appendFileSync(this.options.eventsFile, serialized + '\n', 'utf8');
    if (this.options.observabilityBridge) {
      fs.appendFileSync(this.options.observabilityBridge, serialized + '\n', 'utf8');
    }
  }

  incrementCommand(command: string, status: 'ok' | 'error'): void {
    this.commandCounter.inc({ command, status });
    this.flushMetrics();
  }

  recordCoverage(context: string, meta: 'ok' | 'warn' = 'ok'): void {
    if (!this.options.coverageFile) {
      return;
    }
    const entry: CoverageEntry = { context, meta };
    this.coverageEntries.push(entry);
    fs.appendFileSync(this.options.coverageFile, JSON.stringify(entry) + '\n', 'utf8');
  }

  coverage(): CoverageSnapshot {
    const contexts: Record<string, number> = {};
    let missingMeta = 0;
    for (const entry of this.coverageEntries) {
      contexts[entry.context] = (contexts[entry.context] ?? 0) + 1;
      if (entry.meta !== 'ok') {
        missingMeta += 1;
      }
    }
    return {
      total: this.coverageEntries.length,
      contexts,
      missingMeta,
    };
  }

  tail(limit = 10): TelemetryEvent[] {
    if (!fs.existsSync(this.options.eventsFile)) {
      return [];
    }

    const contents = fs.readFileSync(this.options.eventsFile, 'utf8').trim();
    if (!contents) {
      return [];
    }

    const entries = contents.split(/\r?\n/).slice(-limit);
    return entries
      .map((line) => {
        try {
          return JSON.parse(line) as TelemetryEvent;
        } catch {
          return undefined;
        }
      })
      .filter((item): item is TelemetryEvent => Boolean(item));
  }

  private flushMetrics(): void {
    const output = this.registry.metrics();
    fs.writeFileSync(this.options.metricsFile, output, 'utf8');
  }

  private ensureDirectory(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
}
interface CoverageEntry {
  context: string;
  meta: 'ok' | 'warn';
}

interface CoverageSnapshot {
  total: number;
  contexts: Record<string, number>;
  missingMeta: number;
}
