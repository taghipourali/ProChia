import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  /** Gyms live on `<slug>.<ROOT_DOMAIN>`. */
  ROOT_DOMAIN: z.string().default('prochia.local'),
  /** Branch used when a request carries no subdomain or X-Branch header (local development). */
  DEFAULT_BRANCH: z.string().optional(),
  /** Pepper mixed into OTP hashes. */
  APP_SECRET: z.string().min(16).default('dev-secret-change-me-please'),
  /** Origins allowed to call the API cross-origin (the staff panel in development). */
  CORS_ORIGINS: z.string().default(''),
  COOKIE_SECURE: bool.default(false),

  SMS_PROVIDER: z.enum(['console', 'kavenegar']).default('console'),
  KAVENEGAR_API_KEY: z.string().optional(),
  KAVENEGAR_SENDER: z.string().optional(),
  /** Kavenegar "verify lookup" template for OTP messages (faster delivery than plain SMS). */
  KAVENEGAR_OTP_TEMPLATE: z.string().optional(),

  PAYMENT_GATEWAY: z.enum(['fake', 'zarinpal']).default('fake'),
  ZARINPAL_MERCHANT_ID: z.string().optional(),
  ZARINPAL_SANDBOX: bool.default(false),

  UPLOAD_DIR: z.string().default('./uploads'),
  /** Returns OTP codes in the API response. Refused in production. */
  DEV_ECHO_OTP: bool.default(false),
  RUN_SCHEDULER: bool.default(true),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    if (config.DEV_ECHO_OTP) throw new Error('DEV_ECHO_OTP must be off in production');
    if (config.APP_SECRET.startsWith('dev-')) throw new Error('Set APP_SECRET in production');
    if (config.PAYMENT_GATEWAY === 'fake')
      throw new Error('The fake payment gateway is for development only');
  }
  return config;
}
