import process from 'node:process';

import { AuthClient } from './AuthClient';
import { loadAuthConfig } from './config';
import { createMockFetcher } from './mock';
import { runSecurityChecks } from './securityChecks';
import { TelemetryReporter, tailTelemetry } from './telemetry';
import { WorkflowRunner } from './workflows';

interface CliOptions {
  config?: string;
  json?: boolean;
  live?: boolean;
  probe?: boolean;
}

interface ParsedArgs {
  options: CliOptions;
  command?: string;
  args: string[];
}

export interface CliIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

const DEFAULT_IO: CliIO = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

interface ClientPool {
  live: AuthClient;
  mock: AuthClient;
}

export async function runCli(argv: string[] = process.argv.slice(2), io: CliIO = DEFAULT_IO): Promise<number> {
  const { options, command, args } = parseArgs(argv);
  const resolvedCommand = command ?? 'help';
  const config = loadAuthConfig({ configPath: options.config });
  const telemetry = new TelemetryReporter({ filePath: config.telemetry.filePath, tags: { command: resolvedCommand } });
  const clients = createClientPool(config, telemetry);
  const workflows = new WorkflowRunner(config, clients.live, telemetry);

  const startedAt = Date.now();
  let exitCode = 0;
  let status: 'ok' | 'error' = 'ok';

  try {
    switch (resolvedCommand) {
      case 'config:show': {
        const summary = summarizeConfig(config);
        io.log(renderOutput(summary, options.json));
        break;
      }
      case 'security:check': {
        const results = await runSecurityChecks({ config, telemetry, probeHealth: options.probe !== false });
        io.log(renderOutput(results, options.json));
        if (results.some((result) => !result.ok && result.severity !== 'info')) {
          exitCode = 1;
        }
        break;
      }
      case 'workflows:list': {
        io.log(renderOutput(workflows.list(), options.json));
        break;
      }
      case 'workflows:show': {
        const scenario = workflows.show(requireArg(args, 0, 'workflow id'));
        if (!scenario) {
          throw new Error(`Workflow ${args[0]} is not configured`);
        }
        io.log(renderOutput(scenario, options.json));
        break;
      }
      case 'workflows:run': {
        const workflowId = requireArg(args.filter((token) => !token.startsWith('--')), 0, 'workflow id');
        const execute = options.live || args.includes('--execute');
        const result = await workflows.run(workflowId, { execute });
        io.log(renderOutput(result, options.json));
        break;
      }
      case 'login:password': {
        const username = requireArg(args, 0, 'username');
        const password = requireArg(args, 1, 'password');
        const client = pickClient(clients, options.live);
        const tokens = await client.passwordGrant(username, password);
        io.log(renderOutput(tokens, options.json));
        break;
      }
      case 'token:client': {
        const scopes = parseScopesArg(args[0], config.defaultScopes);
        if (!config.clientSecret) {
          throw new Error('clientSecret missing from config; set auth.clientSecret before running client credentials.');
        }
        const client = pickClient(clients, options.live);
        const tokens = await client.clientCredentials(config.clientId, config.clientSecret, scopes);
        io.log(renderOutput(tokens, options.json));
        break;
      }
      case 'token:refresh': {
        const refreshToken = requireArg(args, 0, 'refresh token');
        const client = pickClient(clients, options.live);
        const tokens = await client.refresh(refreshToken);
        io.log(renderOutput(tokens, options.json));
        break;
      }
      case 'userinfo': {
        const accessToken = requireArg(args, 0, 'access token');
        const client = pickClient(clients, options.live);
        const info = await client.userinfo(accessToken);
        io.log(renderOutput(info, options.json));
        break;
      }
      case 'sessions': {
        const accessToken = requireArg(args, 0, 'access token');
        const client = pickClient(clients, options.live);
        const sessions = await client.sessions(accessToken);
        io.log(renderOutput(sessions, options.json));
        break;
      }
      case 'events:stream': {
        const lastId = args[0] && !args[0].startsWith('--') ? Number(args[0]) : undefined;
        const client = pickClient(clients, options.live);
        const payload = await client.eventsStream(Number.isFinite(lastId) ? lastId : undefined);
        io.log(renderOutput(payload, options.json));
        break;
      }
      case 'telemetry:tail': {
        const limitArg = args[0] && !args[0].startsWith('--') ? Number(args[0]) : undefined;
        const events = tailTelemetry(config.telemetry.filePath, limitArg ?? config.telemetry.tailLimit);
        io.log(renderOutput(events, options.json));
        break;
      }
      case 'help':
      default:
        io.log(renderHelp());
        break;
    }
  } catch (error) {
    status = 'error';
    exitCode = 1;
    io.error(`[auth-cli] ${(error as Error).message}`);
  } finally {
    telemetry.emit({ action: 'cli', ok: status === 'ok', meta: { command: resolvedCommand, durationMs: Date.now() - startedAt } });
  }

  return exitCode;
}

export const run = runCli;

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
  const options: CliOptions = { probe: true };
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
    if (token === '--live') {
      options.live = true;
      continue;
    }
    if (token === '--no-probe') {
      options.probe = false;
      continue;
    }

    positionals.push(token);
  }

  const [command, ...args] = positionals;
  return { options, command, args };
}

function renderOutput(payload: unknown, preferJson?: boolean): string {
  if (preferJson) {
    return JSON.stringify(payload, null, 2);
  }

  if (typeof payload === 'string') {
    return payload;
  }

  return JSON.stringify(payload, null, 2);
}

function summarizeConfig(config: ReturnType<typeof loadAuthConfig>): Record<string, unknown> {
  return {
    baseUrl: config.baseUrl,
    clientId: config.clientId,
    telemetry: config.telemetry,
    integrations: config.integrations,
    workflows: config.workflows.map((workflow) => ({ id: workflow.id, type: workflow.type, description: workflow.description })),
    profile: config.profile,
  };
}

function renderHelp(): string {
  return [
    'BlackCat Auth JS CLI',
    '',
    'Commands:',
    '  config:show            Print resolved config summary',
    '  security:check         Run security + integration checks',
    '  workflows:list         List configured auth workflows',
    '  workflows:show <id>    Show workflow details',
    '  workflows:run <id>     Execute workflow (use --execute or --live to call the API)',
    '  login:password <u> <p> Acquire tokens via username/password (mocked unless --live)',
    '  token:client [scopes]  Run client-credentials grant (comma-separated scopes)',
    '  token:refresh <token>  Refresh access/refresh token pair',
    '  userinfo <token>       Resolve claims for an access token',
    '  sessions <token>       List active sessions for the user',
    '  events:stream [id]     Tail auth events stream',
    '  telemetry:tail [n]     Tail CLI telemetry events',
    '',
    'Options:',
    '  --config=path          Override config file path',
    '  --json                 Emit machine-readable JSON',
    '  --live                 Execute workflows against the live API',
    '  --no-probe             Skip HTTP health probe during security:check',
  ].join('\n');
}

function requireArg(args: string[], index: number, label: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function createClientPool(config: ReturnType<typeof loadAuthConfig>, telemetry: TelemetryReporter): ClientPool {
  const baseOptions = {
    baseUrl: config.baseUrl,
    defaultHeaders: config.defaultHeaders,
    telemetry,
    timeoutMs: config.timeoutMs,
  };

  return {
    live: new AuthClient(baseOptions),
    mock: new AuthClient({
      ...baseOptions,
      fetcher: createMockFetcher(config),
    }),
  };
}

function pickClient(pool: ClientPool, live?: boolean): AuthClient {
  return live ? pool.live : pool.mock;
}

function parseScopesArg(token: string | undefined, fallback: string[]): string[] {
  if (!token) {
    return fallback;
  }
  return token
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}
