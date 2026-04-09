import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { runChecks } from './checks';
import { loadCryptoConfig } from './config';
import { LocalCipher } from './LocalCipher';
import { SlotRegistry } from './SlotRegistry';
import { Telemetry } from './telemetry';
import { WorkflowRunner } from './workflows';

export interface CliIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

const defaultIO: CliIO = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

interface CliOptions {
  config?: string;
  json?: boolean;
  execute?: boolean;
  payload?: string;
  tail?: number;
  manifest?: string;
  output?: string;
  table?: boolean;
  top?: number;
}

interface ParsedArgs {
  options: CliOptions;
  command?: string;
  args: string[];
}

export async function runCli(argv: string[] = process.argv.slice(2), io: CliIO = defaultIO): Promise<number> {
  const { options, command, args } = parseArgs(argv);
  const resolvedCommand = command ?? 'help';
  const config = loadCryptoConfig({ configPath: options.config });
  const telemetry = new Telemetry(config.telemetry);
  const cipher = await LocalCipher.fromKey(config.encryptionKey);
  const slots = await SlotRegistry.fromConfig(config.hmacSlots);
  const runner = new WorkflowRunner(config, cipher, slots);

  let exitCode = 0;
  let status: 'ok' | 'error' = 'ok';
  const startedAt = Date.now();

  try {
    switch (resolvedCommand) {
      case 'config:show':
        io.log(renderOutput(sanitizeConfig(config), options.json));
        break;
      case 'checks:run': {
        const suite = runChecks(config);
        io.log(renderOutput(suite, options.json));
        if (!suite.passed) {
          exitCode = 2;
        }
        break;
      }
      case 'workflows:list':
        io.log(renderOutput(runner.list(), options.json));
        break;
      case 'workflows:run': {
        const workflowId = requireArg(args, 0, 'workflow id');
        const result = await runner.run(workflowId, { execute: options.execute, payloadOverride: options.payload });
        io.log(renderOutput(result, options.json));
        if (result.dryRun && !options.json) {
          io.log('(Dry-run only. Pass --execute to call crypto APIs.)');
        }
        break;
      }
      case 'slots:list':
        io.log(renderOutput(Object.keys(config.hmacSlots), options.json));
        break;
      case 'slots:sync': {
        const manifestPath = options.manifest ?? process.env.BLACKCAT_CRYPTO_MANIFEST;
        if (!manifestPath) {
          throw new Error('Set --manifest=path or BLACKCAT_CRYPTO_MANIFEST before running slots:sync');
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, any>;
        const slots = manifest?.slots ?? {};
        const hmacTemplate: Record<string, Record<string, string>> = {};
        Object.entries(slots).forEach(([name, definition]) => {
          const type = (definition as Record<string, unknown>)?.type;
          if (String(type).toLowerCase() === 'hmac') {
            hmacTemplate[name] = { type: 'hmac', context: name };
          }
        });
        const payload = JSON.stringify({ hmacSlots: hmacTemplate }, null, 2);
        if (options.output) {
          const target = path.resolve(options.output);
          fs.writeFileSync(target, payload);
          io.log(`HMAC slots exported to ${target}`);
        } else {
          io.log(payload);
        }
        break;
      }
      case 'slots:sign': {
        const slotName = requireArg(args, 0, 'slot name');
        const payload = requireArg(args, 1, 'payload');
        const verifier = args[2];
        const slot = slots.get(slotName);
        const signature = await slot.sign(payload);
        let verified: boolean | undefined;
        if (verifier) {
          verified = await slot.verify(payload, verifier);
        }
        io.log(
          renderOutput(
            {
              slot: slotName,
              signature,
              verified,
            },
            options.json,
          ),
        );
        break;
      }
      case 'telemetry:tail': {
        const limit = options.tail ?? (args[0] ? Number(args[0]) : config.telemetry.tailLimit);
        const events = telemetry.tail(limit);
        io.log(renderOutput(events, options.json));
        break;
      }
      case 'coverage:print': {
        const coverage = telemetry.coverage();
        if (options.table) {
          io.log(renderCoverageTable(coverage, options.top ?? 10));
        } else {
          io.log(renderOutput(coverage, options.json));
        }
        break;
      }
      case 'help':
      default:
        io.log(renderHelp());
        break;
    }
  } catch (error) {
    status = 'error';
    exitCode = exitCode || 1;
    io.error(`[crypto-cli] ${(error as Error).message}`);
  } finally {
    telemetry.record('cli.command', {
      command: resolvedCommand,
      status,
      durationMs: Date.now() - startedAt,
      configPath: config.configPath,
    });
    telemetry.incrementCommand(resolvedCommand, status);
  }

  return exitCode;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  runCli().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: CliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--config') {
      options.config = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--config=')) {
      options.config = token.split('=')[1];
      continue;
    }
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--execute') {
      options.execute = true;
      continue;
    }
    if (token === '--payload') {
      options.payload = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--payload=')) {
      options.payload = token.split('=')[1];
      continue;
    }
    if (token === '--tail') {
      options.tail = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith('--tail=')) {
      options.tail = Number(token.split('=')[1]);
      continue;
    }
    if (token === '--table') {
      options.table = true;
      continue;
    }
    if (token.startsWith('--top=')) {
      options.top = Number(token.split('=')[1]);
      continue;
    }

    positionals.push(token);
  }

  const [command, ...args] = positionals;
  return { options, command, args };
}

function renderOutput(payload: unknown, preferJson = false): string {
  if (preferJson) {
    return JSON.stringify(payload, null, 2);
  }
  if (typeof payload === 'string') {
    return payload;
  }
  return JSON.stringify(payload, null, 2);
}

function requireArg(args: string[], index: number, label: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function sanitizeConfig(config: ReturnType<typeof loadCryptoConfig>): Record<string, unknown> {
  return {
    configPath: config.configPath,
    profile: config.profile
      ? {
          file: config.profile.file,
          name: config.profile.name,
          environment: config.profile.environment,
          status: config.profile.status,
        }
      : undefined,
    defaultContext: config.defaultContext,
    allowedContexts: config.allowedContexts,
    telemetry: config.telemetry,
    integrations: config.integrations,
    workflows: config.workflows,
    hmacSlots: Object.keys(config.hmacSlots),
    encryptionKey: `${config.encryptionKeyPreview}... (${config.encryptionKey.length} bytes)`,
  };
}

function renderHelp(): string {
  return [
    'BlackCat Crypto JS CLI',
    '',
    'Commands:',
    '  config:show             Print resolved config summary',
    '  checks:run              Run security + integration checks',
    '  workflows:list          Show configured envelope/signature workflows',
    '  workflows:run <id>      Execute a workflow (use --execute to call crypto APIs)',
    '  slots:list              List configured HMAC slots',
    '  slots:sign <slot> <p>   Sign a payload via the given slot',
    '  telemetry:tail [limit]  Tail CLI telemetry events',
    '  coverage:print          Print Vault coverage telemetry (use --table/--top=N for summary view)',
    '',
    'Global options:',
    '  --config=<path>         Override config path (default config/crypto.local.json)',
    '  --json                  Emit JSON responses',
    '  --execute               Execute workflows against real crypto operations',
    '  --payload="text"        Provide inline payload for workflows:run',
  ].join('\n');
}

function renderCoverageTable(coverage: Record<string, any>, top: number): string {
  const contexts = Object.entries(coverage.contexts ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number));
  const limited = Number.isFinite(top) && top > 0 ? contexts.slice(0, top) : contexts;
  const lines = [];
  lines.push(`${'Context'.padEnd(48, ' ')} Events`);
  lines.push(`${'-'.repeat(48)} ------`);
  for (const [context, count] of limited) {
    lines.push(`${String(context).padEnd(48, ' ')} ${count}`);
  }
  lines.push(`${'-'.repeat(48)} ------`);
  lines.push(`${'Total'.padEnd(48, ' ')} ${coverage.total ?? 0}`);
  lines.push(`${'Missing metadata'.padEnd(48, ' ')} ${coverage.missingMeta ?? 0}`);
  return lines.join('\n');
}
    if (token === '--manifest') {
      options.manifest = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--manifest=')) {
      options.manifest = token.split('=')[1];
      continue;
    }
    if (token === '--output') {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith('--output=')) {
      options.output = token.split('=')[1];
      continue;
    }
