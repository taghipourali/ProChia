/**
 * Just enough of Fastify for the API's route modules to run unchanged against a WHATWG `Request`:
 * routing with `:params`, JSON and raw image bodies, cookies, redirects, and hijacked replies for
 * server-sent events. Errors map to the same JSON shape as `apps/api/src/app.ts`.
 */
// Types only: the route modules are typed against Fastify with the cookie plugin.
import type {} from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../../api/src/lib/errors';

type Handler = (req: DemoRequest, reply: DemoReply) => unknown;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export interface CookieJar {
  all(): Record<string, string>;
  set(name: string, value: string, expires?: Date): void;
  delete(name: string): void;
}

export interface DemoRequest {
  method: string;
  url: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  ip: string;
  protocol: string;
  raw: { on(event: 'close', listener: () => void): void };
}

export interface RequestInfo {
  /** Headers the browser does not expose to a service worker (host, forwarded prefix). */
  headers?: Record<string, string>;
  ip?: string;
}

const encoder = new TextEncoder();

export class DemoReply {
  statusCode = 200;
  sent = false;
  payload: unknown;
  stream: ReadableStream<Uint8Array> | null = null;
  private readonly headers: Record<string, string> = {};
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(
    private readonly jar: CookieJar,
    private readonly onClose: () => void,
  ) {}

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  code(code: number) {
    return this.status(code);
  }

  header(name: string, value: string | number) {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  type(contentType: string) {
    return this.header('content-type', contentType);
  }

  getHeaders() {
    return { ...this.headers };
  }

  send(payload?: unknown) {
    this.payload = payload;
    this.sent = true;
    return this;
  }

  redirect(url: string, code = 302) {
    this.statusCode = code;
    this.header('location', url);
    this.sent = true;
    return this;
  }

  setCookie(name: string, value: string, opts: { expires?: Date } = {}) {
    this.jar.set(name, value, opts.expires);
    return this;
  }

  clearCookie(name: string) {
    this.jar.delete(name);
    return this;
  }

  /** The handler takes over the response; `raw` then streams it. */
  hijack() {
    this.sent = true;
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => this.onClose(),
    });
    return this;
  }

  readonly raw = {
    writeHead: (status: number, headers: Record<string, string>) => {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers)) this.header(k, v);
    },
    write: (chunk: string) => {
      try {
        this.controller?.enqueue(encoder.encode(chunk));
      } catch {
        this.onClose(); // the reader went away
      }
      return true;
    },
    end: () => {
      try {
        this.controller?.close();
      } catch {
        // already closed
      }
    },
  };

  toResponse(): Response {
    const headers = new Headers(this.headers);
    if (this.stream) return new Response(this.stream, { status: this.statusCode, headers });
    const payload = this.payload;
    const empty = payload === undefined || payload === null;
    if (empty || this.statusCode === 204 || this.statusCode === 304 || headers.has('location')) {
      return new Response(null, { status: this.statusCode, headers });
    }
    if (typeof payload === 'string') {
      if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
      return new Response(payload, { status: this.statusCode, headers });
    }
    if (payload instanceof Uint8Array) {
      return new Response(payload as BodyInit, { status: this.statusCode, headers });
    }
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(payload), { status: this.statusCode, headers });
  }
}

export class DemoServer {
  private readonly routes: Route[] = [];

  constructor(private readonly jar: CookieJar) {}

  /** The route modules only call the verb methods, so this stands in for a Fastify instance. */
  asFastify() {
    return this as unknown as FastifyInstance;
  }

  get = this.register('GET');
  post = this.register('POST');
  put = this.register('PUT');
  patch = this.register('PATCH');
  delete = this.register('DELETE');

  private register(method: string) {
    return (path: string, optsOrHandler: object | Handler, maybeHandler?: Handler) => {
      const handler = (maybeHandler ?? optsOrHandler) as Handler;
      this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
    };
  }

  /** `path` is relative to the API root, e.g. `/api/v1/menu?x=1`. */
  async handle(request: Request, path: string, info: RequestInfo = {}): Promise<Response> {
    const url = new URL(path, 'http://demo.invalid');
    const match = this.match(request.method === 'HEAD' ? 'GET' : request.method, url.pathname);
    if (!match) return json(404, { error: { code: 'not_found', message: 'پیدا نشد' } });

    const closeListeners: (() => void)[] = [];
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      for (const listener of closeListeners) listener();
    };
    request.signal?.addEventListener('abort', close);

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => (headers[key] = value));
    Object.assign(headers, info.headers);

    const reply = new DemoReply(this.jar, close);
    try {
      const req: DemoRequest = {
        method: request.method,
        url: url.pathname + url.search,
        params: match.params,
        query: parseQuery(url.searchParams),
        body: await readBody(request),
        headers,
        cookies: this.jar.all(),
        ip: info.ip ?? '127.0.0.1',
        protocol: (headers['x-forwarded-proto'] ?? 'https').split(',')[0]!,
        raw: { on: (_event, listener) => void closeListeners.push(listener) },
      };
      const result = await match.handler(req, reply);
      if (!reply.sent) reply.send(result);
      return reply.toResponse();
    } catch (err) {
      return errorResponse(err);
    }
  }

  private match(method: string, pathname: string) {
    const parts = pathname.split('/').filter(Boolean);
    let best: { route: Route; params: Record<string, string>; score: string } | null = null;
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchParts(route.parts, parts);
      if (!params) continue;
      // Like Fastify, a static segment beats a parameter at the same position.
      const score = route.parts.map((p) => (p.startsWith(':') || p === '*' ? '0' : '1')).join('');
      if (!best || score > best.score) best = { route, params, score };
    }
    return best && { handler: best.route.handler, params: best.params };
  }
}

function matchParts(pattern: string[], parts: string[]) {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p === '*') {
      params['*'] = parts.slice(i).map(decodeURIComponent).join('/');
      return params;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(part);
    else if (p !== part) return null;
  }
  return pattern.length === parts.length ? params : null;
}

function parseQuery(search: URLSearchParams) {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of search) {
    const prev = out[key];
    out[key] = prev === undefined ? value : [...(Array.isArray(prev) ? prev : [prev]), value];
  }
  return out;
}

async function readBody(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const type = request.headers.get('content-type') ?? '';
  if (type.startsWith('image/')) {
    const B = (globalThis as unknown as { Buffer: { from(b: ArrayBuffer): Uint8Array } }).Buffer;
    return B.from(await request.arrayBuffer());
  }
  const text = await request.text();
  if (!text) return undefined;
  if (type.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AppError(400, 'bad_request', 'درخواست نامعتبر');
    }
  }
  return text;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return json(err.status, {
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  console.error(err);
  return json(500, { error: { code: 'internal', message: 'خطای غیرمنتظره؛ دوباره تلاش کنید' } });
}
