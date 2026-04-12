import fs from 'node:fs';
import path from 'node:path';

type TelemetryWriter = (event: TelemetryEvent) => void | Promise<void>;

export interface TelemetryEvent {
  action: string;
  ok?: boolean;
  error?: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
  tags?: Record<string, string>;
  timestamp: string;
}

export interface TelemetryOptions {
  writer?: TelemetryWriter;
  filePath?: string;
  tags?: Record<string, string>;
}

export class TelemetryReporter {
  private readonly writer?: TelemetryWriter;
  private readonly filePath?: string;
  private readonly tags: Record<string, string>;

  constructor(options: TelemetryOptions = {}) {
    this.writer = options.writer;
    this.filePath = options.filePath ? path.resolve(options.filePath) : undefined;
    this.tags = { service: 'blackcat-auth-js', ...(options.tags ?? {}) };

    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }
  }

  async run<T>(action: string, meta: Record<string, unknown>, task: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await task();
      this.emit({ action, ok: true, durationMs: Date.now() - startedAt, meta });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ action, ok: false, error: message, durationMs: Date.now() - startedAt, meta });
      throw error;
    }
  }

  emit(event: Omit<TelemetryEvent, 'timestamp' | 'tags'> & { timestamp?: string }): void {
    const payload: TelemetryEvent = {
      ...event,
      tags: this.tags,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    if (this.writer) {
      void this.writer(payload);
    }

    if (this.filePath) {
      fs.appendFileSync(this.filePath, `${JSON.stringify(payload)}\n`, 'utf8');
    }
  }
}

export function tailTelemetry(filePath: string, limit = 10): TelemetryEvent[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const contents = fs.readFileSync(filePath, 'utf8').trim();
  if (!contents) {
    return [];
  }

  const lines = contents.split(/\r?\n/).slice(-limit);
  const events: TelemetryEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as TelemetryEvent;
      events.push(parsed);
    } catch {
      events.push({ action: 'telemetry:parse_error', ok: false, error: line, timestamp: new Date().toISOString() });
    }
  }
  return events;
}
