import { AuthClient, type TokenPair } from './AuthClient';
import type { AuthConfig, WorkflowScenario } from './config';
import type { TelemetryReporter } from './telemetry';

export interface WorkflowRunOptions {
  execute?: boolean;
}

export interface WorkflowRunResult {
  scenario: WorkflowScenario;
  dryRun: boolean;
  steps: string[];
  output?: unknown;
}

export class WorkflowRunner {
  constructor(
    private readonly config: AuthConfig,
    private readonly client: Pick<AuthClient, 'passwordGrant' | 'clientCredentials' | 'requestMagicLink' | 'consumeMagicLink' | 'deviceCode' | 'devicePoll'>,
    private readonly telemetry?: TelemetryReporter,
  ) {}

  list(): WorkflowScenario[] {
    return this.config.workflows;
  }

  show(id: string): WorkflowScenario | undefined {
    return this.config.workflows.find((workflow) => workflow.id === id);
  }

  async run(id: string, options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
    const scenario = this.show(id);
    if (!scenario) {
      throw new Error(`Workflow ${id} is not configured`);
    }

    const dryRun = options.execute !== true;
    const steps: string[] = [];

    const meta = { workflow: scenario.id, type: scenario.type, dryRun };

    try {
      const output = await this.executeScenario(scenario, dryRun, steps);
      this.telemetry?.emit({ action: 'workflow', ok: true, meta });
      return { scenario, dryRun, steps, output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.telemetry?.emit({ action: 'workflow', ok: false, error: message, meta });
      throw error;
    }
  }

  private async executeScenario(
    scenario: WorkflowScenario,
    dryRun: boolean,
    steps: string[],
  ): Promise<unknown> {
    switch (scenario.type) {
      case 'password_grant':
        return this.executePasswordGrant(scenario, dryRun, steps);
      case 'client_credentials':
        return this.executeClientCredentials(scenario, dryRun, steps);
      case 'magic_link':
        return this.executeMagicLink(scenario, dryRun, steps);
      case 'device_code':
        return this.executeDeviceCode(scenario, dryRun, steps);
      default:
        throw new Error(`Workflow type ${(scenario as { type?: string }).type ?? 'unknown'} is not supported`);
    }
  }

  private async executePasswordGrant(
    scenario: WorkflowScenario,
    dryRun: boolean,
    steps: string[],
  ): Promise<TokenPair | undefined> {
    const username = scenario.params?.username;
    const password = scenario.params?.password;
    if (!username || !password) {
      throw new Error(`Workflow ${scenario.id} missing username/password params`);
    }
    steps.push(`Authenticate user ${username}`);
    if (dryRun) {
      steps.push('Dry-run mode: not contacting blackcat-auth');
      return undefined;
    }
    return this.client.passwordGrant(username, password);
  }

  private async executeClientCredentials(
    scenario: WorkflowScenario,
    dryRun: boolean,
    steps: string[],
  ): Promise<TokenPair | undefined> {
    const clientSecret = this.config.clientSecret;
    if (!clientSecret) {
      throw new Error('clientSecret missing in config; cannot run client credentials workflow');
    }

    const scopes = parseScopes(scenario.params?.scopes, this.config.defaultScopes);
    steps.push(`Obtain tokens for ${this.config.clientId} (scopes: ${scopes.join(', ') || 'none'})`);
    if (dryRun) {
      steps.push('Dry-run mode: would call /token with client_credentials');
      return undefined;
    }

    return this.client.clientCredentials(this.config.clientId, clientSecret, scopes);
  }

  private async executeMagicLink(
    scenario: WorkflowScenario,
    dryRun: boolean,
    steps: string[],
  ): Promise<unknown> {
    const email = scenario.params?.email;
    if (!email) {
      throw new Error(`Workflow ${scenario.id} requires params.email`);
    }

    steps.push(`Request magic link for ${email}`);
    if (scenario.params?.redirect) {
      steps.push(`Redirect target: ${scenario.params.redirect}`);
    }

    if (dryRun) {
      steps.push('Dry-run mode: not sending email');
      return undefined;
    }

    return this.client.requestMagicLink(email, scenario.params?.redirect);
  }

  private async executeDeviceCode(
    scenario: WorkflowScenario,
    dryRun: boolean,
    steps: string[],
  ): Promise<unknown> {
    const clientId = scenario.params?.clientId ?? this.config.clientId;
    const scope = scenario.params?.scope ?? this.config.defaultScopes.join(' ');
    steps.push(`Start device-code handshake for client ${clientId} (scope ${scope || 'openid'})`);
    if (dryRun) {
      steps.push('Dry-run mode: would call /device/code');
      return undefined;
    }

    const response = await this.client.deviceCode(clientId, scope);
    steps.push('Received device_code; waiting for approval');
    if (scenario.params?.poll === 'true') {
      await this.client.devicePoll(response.device_code ?? '');
      steps.push('Polled /device/token after mock approval');
    }
    return response;
  }
}

function parseScopes(input: string | undefined, fallback: string[]): string[] {
  if (!input) {
    return fallback;
  }

  return input
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}
