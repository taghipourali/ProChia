import type { Config } from '../../config';

export interface SmsProvider {
  readonly name: string;
  send(phone: string, body: string): Promise<{ messageId: string | null }>;
  /** Template-based OTP delivery when the provider offers a faster route for it. */
  sendOtp(phone: string, code: string, fallbackBody: string): Promise<{ messageId: string | null }>;
}

/** Development provider: prints messages to the API log. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  readonly sent: { phone: string; body: string }[] = [];

  constructor(private readonly log: (msg: string) => void = console.log) {}

  async send(phone: string, body: string) {
    this.sent.push({ phone, body });
    this.log(`[sms → ${phone}] ${body.replace(/\n/g, ' ⏎ ')}`);
    return { messageId: null };
  }

  async sendOtp(phone: string, _code: string, fallbackBody: string) {
    return this.send(phone, fallbackBody);
  }
}

interface KavenegarResponse {
  return: { status: number; message: string };
  entries?: { messageid: number }[];
}

/** https://kavenegar.com/rest.html — `sms/send` for regular messages, `verify/lookup` for OTP. */
export class KavenegarSmsProvider implements SmsProvider {
  readonly name = 'kavenegar';

  constructor(
    private readonly apiKey: string,
    private readonly sender: string | undefined,
    private readonly otpTemplate: string | undefined,
  ) {}

  async send(phone: string, body: string) {
    const params: Record<string, string> = { receptor: phone, message: body };
    if (this.sender) params.sender = this.sender;
    return this.call('sms/send.json', params);
  }

  async sendOtp(phone: string, code: string, fallbackBody: string) {
    if (!this.otpTemplate) return this.send(phone, fallbackBody);
    return this.call('verify/lookup.json', {
      receptor: phone,
      token: code,
      template: this.otpTemplate,
    });
  }

  private async call(path: string, params: Record<string, string>) {
    const res = await fetch(`https://api.kavenegar.com/v1/${this.apiKey}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as KavenegarResponse | null;
    if (!json || json.return.status !== 200) {
      throw new Error(
        `kavenegar ${json?.return.status ?? res.status}: ${json?.return.message ?? res.statusText}`,
      );
    }
    return { messageId: json.entries?.[0] ? String(json.entries[0].messageid) : null };
  }
}

export function createSmsProvider(config: Config, log?: (msg: string) => void): SmsProvider {
  if (config.SMS_PROVIDER === 'kavenegar') {
    if (!config.KAVENEGAR_API_KEY)
      throw new Error('KAVENEGAR_API_KEY is required for the kavenegar SMS provider');
    return new KavenegarSmsProvider(
      config.KAVENEGAR_API_KEY,
      config.KAVENEGAR_SENDER,
      config.KAVENEGAR_OTP_TEMPLATE,
    );
  }
  return new ConsoleSmsProvider(log);
}
