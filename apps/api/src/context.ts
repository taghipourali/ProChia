import type { Config } from './config';
import type { Db } from './db/client';
import type { EventBus } from './lib/bus';
import type { SmsProvider } from './modules/notifications/providers';
import type { PaymentGateway } from './modules/payments/gateways';

/** Everything services need, passed explicitly so tests can swap any part. */
export interface AppContext {
  config: Config;
  db: Db;
  bus: EventBus;
  sms: SmsProvider;
  gateway: PaymentGateway;
  now: () => Date;
}
