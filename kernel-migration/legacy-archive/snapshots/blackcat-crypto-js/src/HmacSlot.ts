const encoder = new TextEncoder();

export class HmacSlot {
  private constructor(private readonly key: CryptoKey) {}

  static async fromSecret(secret: string | Uint8Array): Promise<HmacSlot> {
    const raw = typeof secret === 'string' ? encoder.encode(secret) : secret;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    return new HmacSlot(key);
  }

  async sign(payload: string | Uint8Array): Promise<string> {
    const data = typeof payload === 'string' ? encoder.encode(payload) : payload;
    const signature = await crypto.subtle.sign('HMAC', this.key, data);
    return Buffer.from(signature).toString('base64url');
  }

  async verify(payload: string | Uint8Array, signature: string): Promise<boolean> {
    const data = typeof payload === 'string' ? encoder.encode(payload) : payload;
    const sig = Buffer.from(signature, 'base64url');
    return crypto.subtle.verify('HMAC', this.key, sig, data);
  }
}
