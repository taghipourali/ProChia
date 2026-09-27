import type { z } from 'zod';
import { badRequest } from './errors';

/** Parses request input, turning zod issues into a 400 with the first message in Persian. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  const message =
    first && !first.message.startsWith('Invalid') && !first.message.startsWith('Too')
      ? first.message
      : 'اطلاعات ارسال‌شده معتبر نیست';
  throw badRequest(
    'validation',
    message,
    result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}
