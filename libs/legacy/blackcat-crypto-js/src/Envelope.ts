export type EnvelopeJSON = {
  context: string;
  ciphertext: string;
  meta: Record<string, unknown>;
};

export class Envelope {
  constructor(
    public readonly context: string,
    public readonly ciphertext: Uint8Array,
    public readonly meta: Record<string, unknown> = {}
  ) {}

  static fromJSON(json: EnvelopeJSON): Envelope {
    const bytes = Buffer.from(json.ciphertext, 'base64url');
    return new Envelope(json.context, bytes, json.meta ?? {});
  }

  toJSON(): EnvelopeJSON {
    return {
      context: this.context,
      ciphertext: Buffer.from(this.ciphertext).toString('base64url'),
      meta: this.meta,
    };
  }
}
