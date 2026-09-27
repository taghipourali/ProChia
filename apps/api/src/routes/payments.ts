import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { formatToman } from '@prochia/shared';
import type { AppContext } from '../context';
import { notFound } from '../lib/errors';
import { parse } from '../lib/validate';
import { FakeGateway } from '../modules/payments/gateways';
import { handleGatewayCallback } from '../modules/payments/service';

export function paymentRoutes(app: FastifyInstance, ctx: AppContext) {
  // Zarinpal (and the fake gateway) redirect here with ?Authority=…&Status=OK|NOK
  app.get('/api/v1/payments/:id/callback', async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const q = req.query as Record<string, string | undefined>;
    const path = await handleGatewayCallback(
      ctx,
      id,
      q.Authority ?? q.authority ?? '',
      q.Status ?? q.status ?? 'NOK',
    );
    return reply.redirect(path);
  });

  if (ctx.gateway instanceof FakeGateway) {
    const gateway = ctx.gateway;
    app.get<{ Params: { authority: string } }>(
      '/api/v1/payments/fake-gateway/:authority',
      async (req, reply) => {
        const pending = gateway.lookup(req.params.authority);
        if (!pending) throw notFound('تراکنش آزمایشی پیدا نشد');
        const url = (status: string) =>
          `${pending.callbackUrl}?Authority=${req.params.authority}&Status=${status}`;
        reply.type('text/html; charset=utf-8');
        return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>درگاه آزمایشی</title><style>
body{font-family:system-ui,sans-serif;background:#f4f4ef;color:#0f1a14;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1.5px solid #0f1a14;padding:28px;width:min(360px,90vw)}
h1{font-size:18px;margin:0 0 4px}p{color:#4a574f;margin:0 0 20px}strong{font-size:28px;display:block;margin-bottom:20px}
a{display:block;text-align:center;padding:12px;margin-top:8px;text-decoration:none;border:1.5px solid #0f1a14;color:#0f1a14}
a.ok{background:#146c3c;border-color:#146c3c;color:#fff}</style></head>
<body><main><h1>درگاه پرداخت آزمایشی</h1><p>فقط برای محیط توسعه. پولی جابه‌جا نمی‌شود.</p>
<strong>${formatToman(pending.amount)}</strong>
<a class="ok" href="${url('OK')}">پرداخت موفق</a><a href="${url('NOK')}">انصراف از پرداخت</a></main></body></html>`;
      },
    );
  }
}
