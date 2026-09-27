import { loadConfig } from '../../../api/src/config';

/** The API configuration the demo runs with: one gym, echoed OTP codes, the fake bank. */
export const demoConfig = () =>
  loadConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'pglite://demo',
    ROOT_DOMAIN: 'prochia.ir',
    DEFAULT_BRANCH: 'demo',
    DEV_ECHO_OTP: 'true',
    PAYMENT_GATEWAY: 'fake',
    SMS_PROVIDER: 'console',
    UPLOAD_DIR: '/uploads',
    RUN_SCHEDULER: 'false',
  });
