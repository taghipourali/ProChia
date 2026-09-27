import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BusEvent } from './bus';

/** The origin the member is using (gym subdomain), for building gateway callback URLs. */
export function requestOrigin(req: FastifyRequest): string {
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
  return `${proto}://${host}`;
}

/**
 * Server-sent events. The reply is hijacked, so headers already set by plugins (CORS) are copied
 * over explicitly. A comment line every 25 s keeps proxies from closing the idle connection.
 */
export function openEventStream(
  req: FastifyRequest,
  reply: FastifyReply,
  subscribe: (send: (event: BusEvent | { type: 'hello' }) => void) => () => void,
) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event: BusEvent | { type: 'hello' }) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  res.write('retry: 3000\n\n');
  send({ type: 'hello' });
  const unsubscribe = subscribe(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.raw.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}
