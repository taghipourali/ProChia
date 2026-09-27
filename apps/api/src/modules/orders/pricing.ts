import type { CartLineInput, Nutrition } from '@prochia/shared';
import {
  ZERO_NUTRITION,
  addNutrition,
  formatToman,
  roundNutrition,
  scaleNutrition,
} from '@prochia/shared';
import type { OrderLineOption } from '../../db/schema/orders';
import { badRequest, conflict } from '../../lib/errors';
import { unitNutrition, type Catalog } from '../menu/catalog';

/** Remaining meal credits from one package or meal plan. */
export interface CreditSource {
  subscriptionId: string;
  planName: string;
  remaining: number;
  expiresOn: string;
  eligibleCategoryIds: string[];
  maxItemPrice: number | null;
}

export interface PricingPromotion {
  id: string;
  title: string;
  kind: 'percent' | 'amount';
  value: number;
  maxDiscount: number | null;
  minOrder: number;
  memberCodeId: string | null;
}

export interface PricedLine {
  menuItemId: string;
  categoryId: string;
  stationId: string;
  name: string;
  quantity: number;
  basePrice: number;
  unitPrice: number;
  options: OrderLineOption[];
  optionIds: string[];
  lineTotal: number;
  creditsUsed: number;
  creditValue: number;
  nutrition: Nutrition;
  prepMinutes: number;
  note: string | null;
}

export interface CreditAllocation {
  lineIndex: number;
  subscriptionId: string;
  credits: number;
  value: number;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: number;
  creditsUsed: number;
  creditsValue: number;
  allocations: CreditAllocation[];
  memberDiscountPct: number;
  memberDiscount: number;
  promotion: PricingPromotion | null;
  promoDiscount: number;
  /** Set when a promotion was given but does not apply to this cart. */
  promoError: string | null;
  total: number;
  nutrition: Nutrition;
  prepMinutes: number;
}

/** Validates the chosen options against the item's modifier groups, filling required defaults. */
export function resolveOptions(
  catalog: Catalog,
  menuItemId: string,
  optionIds: string[],
): string[] {
  const item = catalog.items.get(menuItemId)!;
  const chosen = new Set(optionIds);
  if (chosen.size !== optionIds.length)
    throw badRequest('duplicate_option', 'یک گزینه دو بار انتخاب شده است');

  const allowed = new Set(item.groups.flatMap((g) => g.options.map((o) => o.id)));
  for (const id of chosen) {
    if (!allowed.has(id))
      throw badRequest('invalid_option', `گزینه انتخاب‌شده برای «${item.name}» معتبر نیست`);
  }

  const result: string[] = [];
  for (const group of item.groups) {
    let picked = group.options.filter((o) => chosen.has(o.id));
    if (picked.some((o) => !o.isActive))
      throw conflict('option_unavailable', `یکی از گزینه‌های «${item.name}» موجود نیست`);
    if (picked.length === 0 && group.minSelect > 0) {
      picked = group.options.filter((o) => o.isDefault && o.isActive).slice(0, group.maxSelect);
    }
    if (picked.length < group.minSelect) {
      throw badRequest(
        'option_required',
        `برای «${item.name}» گزینه «${group.name}» را انتخاب کنید`,
      );
    }
    if (picked.length > group.maxSelect) {
      throw badRequest(
        'too_many_options',
        `برای «${group.name}» حداکثر ${group.maxSelect} گزینه می‌توانید انتخاب کنید`,
      );
    }
    result.push(...picked.map((o) => o.id));
  }
  return result;
}

/**
 * Prices a cart. Order of operations:
 *   1. Meal credits cover the base price of eligible units, most expensive first, using the
 *      credit that expires soonest (options stay payable).
 *   2. The member discount (best of personal and tier) applies to what is left.
 *   3. One promotion applies on top.
 */
export function priceCart(
  catalog: Catalog,
  cartLines: CartLineInput[],
  ctx: {
    memberDiscountPct: number;
    credits: CreditSource[];
    useCredits: boolean;
    promotion: PricingPromotion | null;
  },
): PricingResult {
  const lines: PricedLine[] = cartLines.map((l) => {
    const item = catalog.items.get(l.itemId);
    if (!item || !item.isPublished)
      throw badRequest('item_not_found', 'یکی از آیتم‌های سبد دیگر در منو نیست');
    if (!item.isAvailable) throw conflict('item_unavailable', `«${item.name}» فعلاً موجود نیست`);
    const optionIds = resolveOptions(catalog, item.id, l.optionIds);
    const options: OrderLineOption[] = optionIds.map((id) => {
      const o = catalog.options.get(id)!;
      const group = item.groups.find((g) => g.id === o.groupId)!;
      return { id, groupName: group.name, name: o.name, priceDelta: o.priceDelta };
    });
    const unitPrice = item.price + options.reduce((s, o) => s + o.priceDelta, 0);
    return {
      menuItemId: item.id,
      categoryId: item.categoryId,
      stationId: item.stationId,
      name: item.name,
      quantity: l.quantity,
      basePrice: item.price,
      unitPrice,
      options,
      optionIds,
      lineTotal: unitPrice * l.quantity,
      creditsUsed: 0,
      creditValue: 0,
      nutrition: unitNutrition(catalog, item.id, optionIds),
      prepMinutes: item.prepMinutes,
      note: l.note ?? null,
    };
  });

  const allocations = ctx.useCredits ? allocateCredits(catalog, lines, ctx.credits) : [];
  for (const a of allocations) {
    lines[a.lineIndex]!.creditsUsed += a.credits;
    lines[a.lineIndex]!.creditValue += a.value;
  }

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const creditsValue = lines.reduce((s, l) => s + l.creditValue, 0);
  const creditsUsed = lines.reduce((s, l) => s + l.creditsUsed, 0);
  const payable = subtotal - creditsValue;
  const memberDiscount = Math.floor((payable * ctx.memberDiscountPct) / 100);
  const afterMember = payable - memberDiscount;

  let promoDiscount = 0;
  let promoError: string | null = null;
  const promotion = ctx.promotion;
  if (promotion) {
    if (afterMember < promotion.minOrder) {
      promoError = `این کد برای سفارش‌های بالای ${formatToman(promotion.minOrder)} است`;
    } else {
      promoDiscount =
        promotion.kind === 'percent'
          ? Math.floor((afterMember * promotion.value) / 100)
          : Math.min(Math.round(promotion.value), afterMember);
      if (promotion.maxDiscount !== null)
        promoDiscount = Math.min(promoDiscount, promotion.maxDiscount);
    }
  }

  let nutrition = ZERO_NUTRITION;
  for (const l of lines)
    nutrition = addNutrition(nutrition, scaleNutrition(l.nutrition, l.quantity));

  return {
    lines,
    subtotal,
    creditsUsed,
    creditsValue,
    allocations,
    memberDiscountPct: ctx.memberDiscountPct,
    memberDiscount,
    promotion: promoDiscount > 0 ? promotion : null,
    promoDiscount,
    promoError,
    total: afterMember - promoDiscount,
    nutrition: roundNutrition(nutrition),
    prepMinutes: Math.max(0, ...lines.map((l) => l.prepMinutes)),
  };
}

function allocateCredits(
  catalog: Catalog,
  lines: PricedLine[],
  sources: CreditSource[],
): CreditAllocation[] {
  const pool = sources
    .filter((s) => s.remaining > 0)
    .map((s) => ({ ...s }))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  if (!pool.length) return [];

  const units: { lineIndex: number; price: number; categoryId: string }[] = [];
  lines.forEach((line, lineIndex) => {
    if (!catalog.items.get(line.menuItemId)?.creditEligible) return;
    for (let u = 0; u < line.quantity; u++)
      units.push({ lineIndex, price: line.basePrice, categoryId: line.categoryId });
  });
  units.sort((a, b) => b.price - a.price);

  const byKey = new Map<string, CreditAllocation>();
  for (const unit of units) {
    const source = pool.find(
      (s) =>
        s.remaining > 0 &&
        (s.eligibleCategoryIds.length === 0 || s.eligibleCategoryIds.includes(unit.categoryId)),
    );
    if (!source) continue;
    source.remaining -= 1;
    const value = Math.min(unit.price, source.maxItemPrice ?? unit.price);
    const key = `${unit.lineIndex}:${source.subscriptionId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.credits += 1;
      existing.value += value;
    } else {
      byKey.set(key, {
        lineIndex: unit.lineIndex,
        subscriptionId: source.subscriptionId,
        credits: 1,
        value,
      });
    }
  }
  return [...byKey.values()];
}
