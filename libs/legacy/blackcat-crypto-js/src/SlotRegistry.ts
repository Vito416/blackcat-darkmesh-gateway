import { HmacSlot } from './HmacSlot';

export type SlotConfig = Record<string, string | Uint8Array>;

export class SlotRegistry {
  private slots: Map<string, HmacSlot> = new Map();

  static async fromConfig(config: SlotConfig): Promise<SlotRegistry> {
    const registry = new SlotRegistry();
    for (const [name, secret] of Object.entries(config)) {
      registry.slots.set(name, await HmacSlot.fromSecret(secret));
    }
    return registry;
  }

  get(slot: string): HmacSlot {
    const instance = this.slots.get(slot);
    if (!instance) {
      throw new Error(`Unknown HMAC slot: ${slot}`);
    }
    return instance;
  }
}
