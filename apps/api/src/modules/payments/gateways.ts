import { randomBytes } from 'node:crypto';
import type { Config } from '../../config';

export interface GatewayRequest {
  /** Toman. */
  amount: number;
  description: string;
  callbackUrl: string;
  mobile?: string;
}

export interface GatewayVerification {
  ok: boolean;
  refId?: string;
  cardPan?: string;
  message?: string;
}

export interface PaymentGateway {
  readonly name: string;
  request(req: GatewayRequest): Promise<{ authority: string; redirectUrl: string }>;
  verify(req: { authority: string; amount: number }): Promise<GatewayVerification>;
}

interface ZarinpalEnvelope<T> {
  data: T | [];
  errors: { code: number; message: string } | [];
}

/**
 * Zarinpal REST v4. Amounts are sent in rials (the API default) to avoid any ambiguity between
 * the request and verify calls.
 */
export class ZarinpalGateway implements PaymentGateway {
  readonly name = 'zarinpal';
  private readonly base: string;

  constructor(
    private readonly merchantId: string,
    sandbox: boolean,
  ) {
    this.base = sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
  }

  async request(req: GatewayRequest) {
    const res = await this.post<{ code: number; authority: string }>(
      '/pg/v4/payment/request.json',
      {
        merchant_id: this.merchantId,
        amount: req.amount * 10,
        description: req.description,
        callback_url: req.callbackUrl,
        metadata: req.mobile ? { mobile: req.mobile } : {},
      },
    );
    if (!res || res.code !== 100)
      throw new Error(`zarinpal request failed (${res?.code ?? 'no data'})`);
    return { authority: res.authority, redirectUrl: `${this.base}/pg/StartPay/${res.authority}` };
  }

  async verify(req: { authority: string; amount: number }): Promise<GatewayVerification> {
    const res = await this.post<{ code: number; ref_id: number; card_pan: string }>(
      '/pg/v4/payment/verify.json',
      {
        merchant_id: this.merchantId,
        amount: req.amount * 10,
        authority: req.authority,
      },
    );
    // 100 = verified now, 101 = already verified earlier (e.g. a repeated callback).
    if (res && (res.code === 100 || res.code === 101)) {
      return { ok: true, refId: String(res.ref_id), cardPan: res.card_pan };
    }
    return { ok: false, message: `zarinpal verify code ${res?.code ?? 'none'}` };
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as ZarinpalEnvelope<T> | null;
    if (!json || Array.isArray(json.data)) return null;
    return json.data;
  }
}

/**
 * Local stand-in for a bank gateway: redirects to a small page on the API where the developer
 * chooses success or failure. Refused in production by config validation.
 */
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';
  private readonly pending = new Map<string, { amount: number; callbackUrl: string }>();

  async request(req: GatewayRequest) {
    const authority = `FAKE${randomBytes(8).toString('hex').toUpperCase()}`;
    this.pending.set(authority, { amount: req.amount, callbackUrl: req.callbackUrl });
    const origin = new URL(req.callbackUrl).origin;
    return { authority, redirectUrl: `${origin}/api/v1/payments/fake-gateway/${authority}` };
  }

  lookup(authority: string) {
    return this.pending.get(authority);
  }

  async verify(req: { authority: string; amount: number }): Promise<GatewayVerification> {
    const p = this.pending.get(req.authority);
    if (!p || p.amount !== req.amount) return { ok: false, message: 'unknown authority' };
    return { ok: true, refId: String(Date.now()).slice(-9), cardPan: '6037-99**-****-1234' };
  }
}

export function createGateway(config: Config): PaymentGateway {
  if (config.PAYMENT_GATEWAY === 'zarinpal') {
    if (!config.ZARINPAL_MERCHANT_ID)
      throw new Error('ZARINPAL_MERCHANT_ID is required for the zarinpal gateway');
    return new ZarinpalGateway(config.ZARINPAL_MERCHANT_ID, config.ZARINPAL_SANDBOX);
  }
  return new FakeGateway();
}
