/**
 * Menu photo uploads write here. Files live in Cache Storage, which the service worker also serves
 * `/uploads/*` from, so photos survive the worker being restarted.
 */
export const UPLOADS_CACHE = 'prochia-uploads';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export async function mkdir() {}

export async function writeFile(path: string, data: Uint8Array) {
  const cache = await caches.open(UPLOADS_CACHE);
  const type = TYPES[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
  await cache.put(
    new Request(new URL(path, 'https://uploads.invalid')),
    new Response(new Blob([data as BlobPart], { type }), { headers: { 'content-type': type } }),
  );
}
