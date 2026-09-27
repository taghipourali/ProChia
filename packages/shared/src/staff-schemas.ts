import { z } from 'zod';
import {
  ALLERGENS,
  GOALS,
  INGREDIENT_KINDS,
  ITEM_TAGS,
  MEMBERSHIP_STATUSES,
  PLAN_KINDS,
  PROMOTION_AUDIENCES,
  PROMOTION_KINDS,
  STAFF_ROLES,
  UNITS,
} from './enums';
import { hhmmSchema, isoDateSchema, mobileSchema } from './schemas';

/** Request schemas for the staff panel. */

const text = (max: number) => z.string().trim().min(1, 'این بخش را پر کنید').max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const money = z.number().int().min(0).max(10_000_000_000);
const id = z.uuid();

export const staffLoginInput = z.object({
  username: text(40),
  password: z.string().min(1).max(200),
});

export const acceptOrderInput = z.object({
  removeLineIds: z.array(id).max(30).default([]),
  force: z.boolean().default(false),
});

export const rejectOrderInput = z.object({ reason: text(200) });
export const handoverInput = z.object({ collect: z.boolean().default(false) });
export const ticketActionInput = z.object({ action: z.enum(['start', 'ready', 'reopen']) });
export const paymentReviewInput = z.object({ approve: z.boolean(), note: optionalText(200) });

export const nutritionInput = z.object({
  kcal: z.number().min(0).max(5000),
  protein: z.number().min(-500).max(500),
  carbs: z.number().min(-500).max(500),
  fat: z.number().min(-500).max(500),
  fiber: z.number().min(-200).max(200),
  sugar: z.number().min(-500).max(500),
  sodium: z.number().min(-10000).max(10000),
});

/** Modifier deltas may be negative (swaps), including energy. */
export const nutritionDeltaInput = nutritionInput.extend({ kcal: z.number().min(-5000).max(5000) });

export const categoryInput = z.object({
  name: text(60),
  stationId: id,
  sort: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const menuItemInput = z.object({
  categoryId: id,
  stationId: id,
  name: text(80),
  description: optionalText(400),
  price: money,
  tags: z.array(z.enum(ITEM_TAGS)).default([]),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  nutrition: nutritionInput,
  servingGrams: z.number().min(0).max(5000).nullable().default(null),
  nutritionSource: z.enum(['manual', 'recipe']).default('manual'),
  prepMinutes: z.number().int().min(0).max(240).default(10),
  isPublished: z.boolean().default(true),
  creditEligible: z.boolean().default(true),
  sort: z.number().int().default(0),
  groupIds: z.array(id).max(10).default([]),
});
export type MenuItemInput = z.infer<typeof menuItemInput>;

export const recipeInput = z.object({
  lines: z
    .array(
      z.object({
        ingredientId: id,
        quantity: z
          .number()
          .min(-100_000)
          .max(100_000)
          .refine((v) => v !== 0, 'مقدار نمی‌تواند صفر باشد'),
      }),
    )
    .max(40),
});

export const availabilityInput = z.object({ isAvailable: z.boolean() });

export const modifierGroupInput = z.object({
  name: text(60),
  minSelect: z.number().int().min(0).max(10),
  maxSelect: z.number().int().min(1).max(10),
  sort: z.number().int().default(0),
  options: z
    .array(
      z.object({
        id: id.optional(),
        name: text(60),
        priceDelta: z.number().int().min(-10_000_000).max(10_000_000),
        nutrition: nutritionDeltaInput,
        isDefault: z.boolean().default(false),
        isActive: z.boolean().default(true),
        sort: z.number().int().default(0),
      }),
    )
    .min(1, 'حداقل یک گزینه لازم است')
    .max(20),
});

export const ingredientInput = z.object({
  name: text(80),
  kind: z.enum(INGREDIENT_KINDS),
  unit: z.enum(UNITS),
  nutrition: nutritionInput.nullable(),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  lowStockThreshold: z.number().min(0).max(10_000_000).default(0),
  isActive: z.boolean().default(true),
});

export const purchaseInput = z.object({
  supplier: optionalText(80),
  invoiceNo: optionalText(40),
  note: optionalText(300),
  lines: z
    .array(
      z.object({
        ingredientId: id,
        quantity: z.number().positive().max(10_000_000),
        lineCost: money,
        expiresOn: isoDateSchema.nullish(),
      }),
    )
    .min(1, 'حداقل یک ردیف لازم است')
    .max(60),
});

export const prepRecipeInput = z.object({
  name: text(80),
  outputIngredientId: id,
  outputQuantity: z.number().positive().max(1_000_000),
  note: optionalText(300),
  isActive: z.boolean().default(true),
  inputs: z
    .array(z.object({ ingredientId: id, quantity: z.number().positive().max(1_000_000) }))
    .min(1)
    .max(20),
});

export const productionInput = z.object({
  prepRecipeId: id.nullish(),
  outputIngredientId: id.optional(),
  outputQuantity: z.number().positive().max(1_000_000),
  batches: z.number().positive().max(100).optional(),
  inputs: z
    .array(z.object({ ingredientId: id, quantity: z.number().positive().max(1_000_000) }))
    .max(20)
    .optional(),
  note: optionalText(300),
});

export const stockAdjustInput = z.object({
  ingredientId: id,
  reason: z.enum(['waste', 'adjustment']),
  quantity: z.number().positive().optional(),
  countedOnHand: z.number().min(-1_000_000).max(10_000_000).optional(),
  note: optionalText(300),
});

export const memberUpdateInput = z.object({
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  isVip: z.boolean().optional(),
  creditLimit: money.optional(),
  personalDiscountPct: z.number().int().min(0).max(100).optional(),
  gymMemberCode: optionalText(32).optional(),
  note: optionalText(500).optional(),
});

export const walletAdjustInput = z.object({
  /** `topup`: cash received at the counter (earns the top-up bonus). `adjustment`: a correction. */
  kind: z.enum(['topup', 'adjustment']),
  amount: z
    .number()
    .int()
    .min(-100_000_000)
    .max(500_000_000)
    .refine((v) => v !== 0, 'مبلغ نمی‌تواند صفر باشد'),
  note: text(200),
});

export const whitelistImportInput = z.object({
  entries: z
    .array(
      z.object({ phone: mobileSchema, gymMemberCode: optionalText(32), note: optionalText(100) }),
    )
    .min(1)
    .max(5000),
});

export const tierInput = z.object({
  name: text(40),
  minSpend: money,
  discountPct: z.number().int().min(0).max(50),
  perks: optionalText(300),
  sort: z.number().int().default(0),
});

export const promotionInput = z
  .object({
    title: text(80),
    description: optionalText(300),
    kind: z.enum(PROMOTION_KINDS),
    value: z.number().positive(),
    maxDiscount: money.nullable().default(null),
    minOrder: money.default(0),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,32}$/, 'کد فقط حروف انگلیسی، عدد و خط تیره')
      .nullable()
      .default(null),
    audience: z.enum(PROMOTION_AUDIENCES),
    tierId: id.nullable().default(null),
    goal: z.enum(GOALS).nullable().default(null),
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    usageLimit: z.number().int().positive().nullable().default(null),
    perMemberLimit: z.number().int().min(1).max(1000).default(1),
    personalCodeDays: z.number().int().min(1).max(60).default(7),
    isActive: z.boolean().default(true),
  })
  .refine((p) => p.kind !== 'percent' || p.value <= 100, {
    message: 'درصد تخفیف حداکثر ۱۰۰ است',
    path: ['value'],
  })
  .refine((p) => p.audience !== 'tier' || p.tierId, {
    message: 'سطح باشگاه را انتخاب کنید',
    path: ['tierId'],
  })
  .refine((p) => p.audience !== 'goal' || p.goal, {
    message: 'هدف تمرینی را انتخاب کنید',
    path: ['goal'],
  });

export const cashbackRuleInput = z.object({
  title: text(80),
  minAmount: money,
  percent: z.number().min(0.1).max(50),
  maxBonus: money.nullable().default(null),
  startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  isActive: z.boolean().default(true),
});

export const planInput = z.object({
  kind: z.enum(PLAN_KINDS),
  name: text(80),
  description: optionalText(500),
  goal: z.enum(GOALS).nullable().default(null),
  meals: z.number().int().min(1).max(365),
  validityDays: z.number().int().min(1).max(365),
  price: money,
  compareAtPrice: money.nullable().default(null),
  mealsPerDay: z.number().int().min(1).max(6).nullable().default(null),
  eligibleCategoryIds: z.array(id).default([]),
  maxItemPrice: money.nullable().default(null),
  isFeatured: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sort: z.number().int().default(0),
});

export const spotInput = z.object({
  label: text(60),
  stationId: id.nullable().default(null),
  isActive: z.boolean().default(true),
});

export const campaignInput = z.object({
  title: text(80),
  body: text(300),
  audience: z
    .object({
      goal: z.enum(GOALS).nullable().optional(),
      tierId: id.nullable().optional(),
      vipOnly: z.boolean().optional(),
      inactiveDays: z.number().int().min(1).max(365).nullable().optional(),
    })
    .default({}),
});

const hoursRanges = z.array(z.tuple([hhmmSchema, hhmmSchema])).max(4);

export const branchSettingsInput = z.object({
  name: text(80),
  gymName: text(80),
  address: optionalText(300),
  phone: optionalText(20),
  instagram: optionalText(60),
  whatsapp: optionalText(20),
  cardNumber: z
    .string()
    .trim()
    .regex(/^[\d-]{16,19}$/, 'شماره کارت ۱۶ رقمی')
    .nullable()
    .default(null),
  cardHolder: optionalText(80),
  openingHours: z.partialRecord(z.enum(['0', '1', '2', '3', '4', '5', '6']), hoursRanges),
  settings: z.object({
    memberApproval: z.enum(['auto', 'whitelist', 'manual']),
    autoAccept: z.boolean(),
    enforceStock: z.boolean(),
    preorderMaxDays: z.number().int().min(0).max(14),
    preorderMinLeadMinutes: z.number().int().min(5).max(240),
    tierWindowDays: z.number().int().min(7).max(365),
    birthdayPromotionId: id.nullable(),
    lowCreditsThreshold: z.number().int().min(0).max(20),
  }),
});

export const stationInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,20}$/),
  name: text(60),
  floorLabel: optionalText(40),
  isAcceptance: z.boolean(),
  defaultPrepMinutes: z.number().int().min(1).max(120),
  sort: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const staffInput = z.object({
  name: text(60),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'نام کاربری: حروف انگلیسی کوچک، عدد، نقطه یا خط تیره'),
  password: z.string().min(8, 'رمز عبور حداقل ۸ کاراکتر').max(200).optional(),
  role: z.enum(STAFF_ROLES),
  isActive: z.boolean().default(true),
});

export const branchCreateInput = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}$/, 'زیردامنه: حروف انگلیسی کوچک، عدد و خط تیره'),
  name: text(80),
  gymName: text(80),
});
