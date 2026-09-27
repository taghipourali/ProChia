import { Buffer } from 'buffer';

// Node globals the API code touches.
const g = globalThis as { Buffer?: unknown; process?: unknown };
g.Buffer ??= Buffer;
g.process ??= { env: { NODE_ENV: 'production' } };

// The `buffer` polyfill predates Node's base64url encoding, which session tokens use.
const toString = Buffer.prototype.toString;
Buffer.prototype.toString = function (
  this: Buffer,
  encoding?: string,
  start?: number,
  end?: number,
) {
  if (encoding !== 'base64url') return toString.call(this, encoding as BufferEncoding, start, end);
  return toString
    .call(this, 'base64', start, end)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};
