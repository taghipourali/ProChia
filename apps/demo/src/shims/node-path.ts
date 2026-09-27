/** POSIX path helpers for the upload route; the working directory is `/`. */
function normalize(parts: string[]) {
  const out: string[] = [];
  for (const part of parts.join('/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

export const sep = '/';

export function resolve(...parts: string[]) {
  const from = parts.findLastIndex((p) => p.startsWith('/'));
  return normalize(from === -1 ? parts : parts.slice(from));
}

export function join(...parts: string[]) {
  return normalize(parts);
}

export function extname(p: string) {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

export default { sep, resolve, join, extname };
