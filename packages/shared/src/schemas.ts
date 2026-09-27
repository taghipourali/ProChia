import { z } from 'zod';
import {
  ACTIVITY_LEVELS,
  ALLERGENS,
  DIET_PREFERENCES,
  GOALS,
  ORDER_TYPES,
  PAYMENT_METHODS,
  SEXES,
  TRAINING_TIMES,
} from './enums';
import { normalizeIranMobile, toEnDigits } from './fa';

/** Request schemas shared by the API (validation) and the apps (form validation). */

export const mobileSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeIranMobile(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'شماره موبایل معتبر نیست' });
    return z.NEVER;
  }
  return normalized;
});

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت معتبر نیست');
const nameSchema = z.string().trim().min(1, 'این بخش را پر کنید').max(40);

export const otpRequestInput = z.object({ phone: mobileSchema });

export const otpVerifyInput = z.object({
  phone: mobileSchema,
  code: z
    .string()
    .transform((v) => toEnDigits(v).trim())
    .pipe(z.string().regex(/^\d{5}$/, 'کد ۵ رقمی است')),
});

export const profileInput = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  birthDate: isoDateSchema.nullable(),
  sex: z.enum(SEXES).nullable(),
});
export type ProfileInput = z.infer<typeof profileInput>;

export const healthProfileInput = z.object({
  sex: z.enum(SEXES),
  birthDate: isoDateSchema,
  heightCm: z.number().min(120).max(230),
  weightKg: z.number().min(30).max(250),
  bodyFatPct: z.number().min(3).max(60).nullable(),
  activity: z.enum(ACTIVITY_LEVELS),
  goal: z.enum(GOALS),
  trainingTime: z.enum(TRAINING_TIMES),
  trainingDaysPerWeek: z.number().int().min(0).max(7),
  mealsPerDay: z.number().int().min(2).max(6),
  allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
  dietPreferences: z.array(z.enum(DIET_PREFERENCES)).max(DIET_PREFERENCES.length),
});
export type HealthProfileInput = z.infer<typeof healthProfileInput>;

export const weightLogInput = z.object({ weightKg: z.number().min(30).max(250) });

export const cartLineInput = z.object({
  itemId: z.uuid(),
  quantity: z.number().int().min(1).max(20),
  optionIds: z.array(z.uuid()).max(20).default([]),
  note: z.string().trim().max(140).optional(),
});
export type CartLineInput = z.infer<typeof cartLineInput>;

export const cartInput = z.object({
  lines: z.array(cartLineInput).min(1, 'سبد خرید خالی است').max(30),
  promoCode: z.string().trim().max(32).optional(),
  useCredits: z.boolean().default(true),
});
export type CartInput = z.infer<typeof cartInput>;

export const cardToCardInput = z.object({
  trackingCode: z
    .string()
    .transform((v) => toEnDigits(v).trim())
    .pipe(z.string().min(4, 'کد پیگیری را وارد کنید').max(32)),
  cardLast4: z
    .string()
    .transform((v) => toEnDigits(v).trim())
    .pipe(z.string().regex(/^\d{4}$/, '۴ رقم آخر کارت')),
});
export type CardToCardInput = z.infer<typeof cardToCardInput>;

export const checkoutInput = cartInput.extend({
  type: z.enum(ORDER_TYPES),
  tableCode: z.string().trim().max(16).optional(),
  scheduledFor: z.iso.datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(280).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  cardToCard: cardToCardInput.optional(),
});
export type CheckoutInput = z.infer<typeof checkoutInput>;

export const walletTopupInput = z.object({
  amount: z.number().int().min(100_000, 'حداقل شارژ ۱۰۰ هزار تومان است').max(500_000_000),
  method: z.enum(['gateway', 'card_to_card']),
  cardToCard: cardToCardInput.optional(),
});
export type WalletTopupInput = z.infer<typeof walletTopupInput>;

export const planPurchaseInput = z.object({
  method: z.enum(['gateway', 'wallet', 'card_to_card']),
  cardToCard: cardToCardInput.optional(),
  startsOn: isoDateSchema.optional(),
});
export type PlanPurchaseInput = z.infer<typeof planPurchaseInput>;

export const subscriptionScheduleInput = z.object({
  enabled: z.boolean(),
  /** 0 = Sunday … 6 = Saturday, like Date.getDay(). */
  days: z.array(z.number().int().min(0).max(6)).max(7),
  time: hhmmSchema,
  /** `auto`: the kitchen picks a goal-matched meal each day. `fixed`: rotate through itemIds. */
  mode: z.enum(['auto', 'fixed']),
  itemIds: z.array(z.uuid()).max(14).default([]),
});
export type SubscriptionScheduleInput = z.infer<typeof subscriptionScheduleInput>;

export const postpaidSettleInput = z.object({
  method: z.enum(['gateway', 'wallet', 'card_to_card']),
  cardToCard: cardToCardInput.optional(),
});

export const orderRatingInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(300).optional(),
});

export const analyticsEventsInput = z.object({
  events: z
    .array(
      z.object({
        name: z.string().max(40),
        props: z
          .record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
          .optional(),
        at: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(50),
  anonId: z.string().max(64).optional(),
});
