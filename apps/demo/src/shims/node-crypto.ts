/**
 * The parts of `node:crypto` the API uses, on Web Crypto and @noble/hashes. Password hashes use the
 * same scrypt parameters as Node's defaults, so hashes made by the Node seed verify here.
 */
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Buffer } from 'buffer';

type Data = string | Uint8Array;
const bytes = (v: Data) => (typeof v === 'string' ? new TextEncoder().encode(v) : v);

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`hash ${algorithm} is not available in the demo`);
  const parts: Uint8Array[] = [];
  const hash = {
    update(value: Data) {
      parts.push(bytes(value));
      return hash;
    },
    digest(encoding?: 'hex' | 'base64') {
      const out = Buffer.from(sha256(Buffer.concat(parts)));
      return encoding ? out.toString(encoding) : out;
    },
  };
  return hash;
}

export function randomBytes(size: number) {
  const out = Buffer.alloc(size);
  crypto.getRandomValues(out);
  return out;
}

/** Uniform integer in [min, max), like Node's. */
export function randomInt(min: number, max?: number) {
  if (max === undefined) [min, max] = [0, min];
  const range = max - min;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return min + (buf[0]! % range);
}

export function scrypt(
  password: Data,
  salt: Data,
  keylen: number,
  callback: (err: Error | null, key?: Buffer) => void,
) {
  scryptAsync(bytes(password), bytes(salt), { N: 16384, r: 8, p: 1, dkLen: keylen }).then(
    (key) => callback(null, Buffer.from(key)),
    (err: Error) => callback(err),
  );
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
