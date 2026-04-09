import type { CryptoConfig, WorkflowDefinition } from './config';
import { LocalCipher } from './LocalCipher';
import { SlotRegistry } from './SlotRegistry';

export interface WorkflowRunOptions {
  execute?: boolean;
  payloadOverride?: string;
}

export interface WorkflowRunResult {
  workflow: WorkflowDefinition;
  dryRun: boolean;
  steps: string[];
  output?: Record<string, unknown>;
}

const encoder = new TextEncoder();

export class WorkflowRunner {
  constructor(
    private readonly config: CryptoConfig,
    private readonly cipher: LocalCipher,
    private readonly slots: SlotRegistry,
  ) {}

  list(): WorkflowDefinition[] {
    return this.config.workflows;
  }

  show(id: string): WorkflowDefinition | undefined {
    return this.config.workflows.find((workflow) => workflow.id === id);
  }

  async run(id: string, options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
    const workflow = this.show(id);
    if (!workflow) {
      throw new Error(`Workflow ${id} is not defined in config`);
    }

    const dryRun = options.execute !== true;
    const steps: string[] = [];
    let output: Record<string, unknown> | undefined;

    if (workflow.type === 'encryption') {
      const payload = options.payloadOverride ?? workflow.payload;
      if (!payload) {
        throw new Error(`Workflow ${workflow.id} missing payload value`);
      }
      const plaintext = encoder.encode(payload);
      steps.push(`Encrypt payload for context ${workflow.context}`);
      if (dryRun) {
        steps.push('Dry-run mode: skipping AES-GCM call');
      } else {
        const envelope = await this.cipher.encrypt(workflow.context ?? this.config.defaultContext, plaintext, this.config.metadata);
        output = {
          envelope: envelope.toJSON(),
        };
      }
    } else if (workflow.type === 'signature') {
      const payload = options.payloadOverride ?? workflow.payload;
      if (!payload) {
        throw new Error(`Workflow ${workflow.id} missing payload value`);
      }
      const slotName = workflow.slot ?? 'api';
      const slot = this.slots.get(slotName);
      steps.push(`Sign payload via slot ${slotName}`);
      if (dryRun) {
        steps.push('Dry-run mode: not producing signature');
      } else {
        const signature = await slot.sign(payload);
        output = {
          slot: slotName,
          signature,
        };
      }
    } else {
      throw new Error(`Unsupported workflow type ${workflow.type}`);
    }

    return { workflow, dryRun, steps, output };
  }
}
