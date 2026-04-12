import { Envelope } from './Envelope';

const IV_LENGTH = 12;

export class LocalCipher {
  private constructor(private readonly key: CryptoKey) {}

  static async fromPassword(password: string): Promise<LocalCipher> {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('blackcat-crypto-js'), iterations: 120000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return new LocalCipher(key);
  }

  static async fromKey(raw: Uint8Array): Promise<LocalCipher> {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return new LocalCipher(key);
  }

  async encrypt(context: string, plaintext: Uint8Array, meta: Record<string, unknown> = {}): Promise<Envelope> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      plaintext
    );
    return new Envelope(context, new Uint8Array(ciphertext), {
      ...meta,
      iv: Buffer.from(iv).toString('base64url'),
      createdAt: Date.now(),
    });
  }

  async decrypt(envelope: Envelope): Promise<Uint8Array> {
    const iv = envelope.meta.iv ? Buffer.from(String(envelope.meta.iv), 'base64url') : null;
    if (!iv) {
      throw new Error('Envelope missing IV');
    }
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, this.key, envelope.ciphertext);
    return new Uint8Array(plaintext);
  }
}
