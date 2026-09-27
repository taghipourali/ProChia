import { describe, expect, it } from 'vitest';
import type { Nutrition } from '@prochia/shared';
import type { Catalog, CatalogItem, CatalogOption } from '../src/modules/menu/catalog';
import { priceCart, type CreditSource } from '../src/modules/orders/pricing';
import { AppError } from '../src/lib/errors';

const N = (kcal: number, protein = 0): Nutrition => ({
  kcal,
  protein,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  sodium: 0,
});

function option(
  id: string,
  groupId: string,
  name: string,
  priceDelta: number,
  extra: Partial<CatalogOption> = {},
): CatalogOption {
  return {
    id,
    groupId,
    name,
    priceDelta,
    nutrition: N(0),
    isDefault: false,
    isActive: true,
    sort: 0,
    recipe: [],
    ...extra,
  };
}

function item(id: string, price: number, extra: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    categoryId: 'meals',
    stationId: 'restaurant',
    name: id,
    description: null,
    price,
    imageUrl: null,
    tags: [],
    allergens: [],
    nutrition: N(500, 40),
    servingGrams: null,
    nutritionSource: 'manual',
    prepMinutes: 10,
    isPublished: true,
    isAvailable: true,
    creditEligible: true,
    sort: 0,
    groups: [],
    recipe: [],
    ...extra,
  };
}

const carbGroup = {
  id: 'carb',
  name: 'کربوهیدرات',
  minSelect: 1,
  maxSelect: 1,
  sort: 0,
  options: [
    option('brown', 'carb', 'برنج قهوه‌ای', 0, { isDefault: true }),
    option('quinoa', 'carb', 'کینوآ', 60_000, { nutrition: N(10, 4) }),
  ],
};
const extraGroup = {
  id: 'extra',
  name: 'پروتئین اضافه',
  minSelect: 0,
  maxSelect: 1,
  sort: 1,
  options: [option('chicken', 'extra', 'مرغ اضافه', 150_000, { nutrition: N(150, 24) })],
};

const items = [
  item('bowl', 500_000, { groups: [carbGroup, extraGroup] }),
  item('steak', 700_000),
  item('salad', 300_000, { categoryId: 'salads' }),
  item('latte', 150_000, { categoryId: 'drinks', creditEligible: false }),
];
const catalog: Catalog = {
  categories: [],
  stations: [],
  items: new Map(items.map((i) => [i.id, i])),
  options: new Map(items.flatMap((i) => i.groups.flatMap((g) => g.options)).map((o) => [o.id, o])),
};

const noExtras = {
  memberDiscountPct: 0,
  credits: [] as CreditSource[],
  useCredits: true,
  promotion: null,
};

describe('priceCart', () => {
  it('adds option deltas to price and nutrition, filling required defaults', () => {
    const r = priceCart(
      catalog,
      [{ itemId: 'bowl', quantity: 2, optionIds: ['chicken'] }],
      noExtras,
    );
    const line = r.lines[0]!;
    expect(line.optionIds).toEqual(['brown', 'chicken']);
    expect(line.unitPrice).toBe(650_000);
    expect(line.lineTotal).toBe(1_300_000);
    expect(line.nutrition.protein).toBe(64);
    expect(r.nutrition.kcal).toBe(1300);
    expect(r.total).toBe(1_300_000);
  });

  it('rejects options that do not belong to the item or exceed the group maximum', () => {
    expect(() =>
      priceCart(catalog, [{ itemId: 'steak', quantity: 1, optionIds: ['chicken'] }], noExtras),
    ).toThrow(AppError);
    expect(() =>
      priceCart(
        catalog,
        [{ itemId: 'bowl', quantity: 1, optionIds: ['brown', 'quinoa'] }],
        noExtras,
      ),
    ).toThrow(/حداکثر/);
  });

  it('spends credits on the most expensive eligible units first, from the soonest-expiring plan', () => {
    const credits: CreditSource[] = [
      {
        subscriptionId: 'later',
        planName: 'B',
        remaining: 5,
        expiresOn: '2026-12-01',
        eligibleCategoryIds: [],
        maxItemPrice: null,
      },
      {
        subscriptionId: 'sooner',
        planName: 'A',
        remaining: 1,
        expiresOn: '2026-10-01',
        eligibleCategoryIds: [],
        maxItemPrice: null,
      },
    ];
    const r = priceCart(
      catalog,
      [
        { itemId: 'bowl', quantity: 1, optionIds: ['quinoa'] },
        { itemId: 'steak', quantity: 1, optionIds: [] },
        { itemId: 'latte', quantity: 1, optionIds: [] },
      ],
      { ...noExtras, credits },
    );
    expect(r.allocations).toEqual([
      { lineIndex: 1, subscriptionId: 'sooner', credits: 1, value: 700_000 },
      { lineIndex: 0, subscriptionId: 'later', credits: 1, value: 500_000 },
    ]);
    // The quinoa upgrade and the latte (not credit-eligible) stay payable.
    expect(r.total).toBe(60_000 + 150_000);
    expect(r.creditsUsed).toBe(2);
  });

  it('caps credit value at the plan maximum and respects category eligibility', () => {
    const credits: CreditSource[] = [
      {
        subscriptionId: 'p',
        planName: 'P',
        remaining: 3,
        expiresOn: '2026-12-01',
        eligibleCategoryIds: ['meals'],
        maxItemPrice: 550_000,
      },
    ];
    const r = priceCart(
      catalog,
      [
        { itemId: 'steak', quantity: 1, optionIds: [] },
        { itemId: 'salad', quantity: 1, optionIds: [] },
      ],
      { ...noExtras, credits },
    );
    expect(r.creditsValue).toBe(550_000);
    expect(r.total).toBe(150_000 + 300_000);
  });

  it('does not use credits when the member opts out', () => {
    const credits: CreditSource[] = [
      {
        subscriptionId: 'p',
        planName: 'P',
        remaining: 3,
        expiresOn: '2026-12-01',
        eligibleCategoryIds: [],
        maxItemPrice: null,
      },
    ];
    const r = priceCart(catalog, [{ itemId: 'steak', quantity: 1, optionIds: [] }], {
      ...noExtras,
      credits,
      useCredits: false,
    });
    expect(r.creditsUsed).toBe(0);
    expect(r.total).toBe(700_000);
  });

  it('applies the member discount, then the promotion, on what credits do not cover', () => {
    const r = priceCart(catalog, [{ itemId: 'steak', quantity: 2, optionIds: [] }], {
      ...noExtras,
      memberDiscountPct: 10,
      promotion: {
        id: 'p',
        title: 't',
        kind: 'percent',
        value: 20,
        maxDiscount: 200_000,
        minOrder: 0,
        memberCodeId: null,
      },
    });
    expect(r.subtotal).toBe(1_400_000);
    expect(r.memberDiscount).toBe(140_000);
    // 20% of 1,260,000 = 252,000, capped at 200,000.
    expect(r.promoDiscount).toBe(200_000);
    expect(r.total).toBe(1_060_000);
  });

  it('reports a promotion whose minimum is not met instead of applying it', () => {
    const r = priceCart(catalog, [{ itemId: 'latte', quantity: 1, optionIds: [] }], {
      ...noExtras,
      promotion: {
        id: 'p',
        title: 't',
        kind: 'amount',
        value: 50_000,
        maxDiscount: null,
        minOrder: 400_000,
        memberCodeId: null,
      },
    });
    expect(r.promoDiscount).toBe(0);
    expect(r.promotion).toBeNull();
    expect(r.promoError).toMatch(/بالای/);
  });

  it('refuses unavailable items', () => {
    const soldOut: Catalog = {
      ...catalog,
      items: new Map(
        [...catalog.items].map(([k, v]) => [k, k === 'salad' ? { ...v, isAvailable: false } : v]),
      ),
    };
    expect(() =>
      priceCart(soldOut, [{ itemId: 'salad', quantity: 1, optionIds: [] }], noExtras),
    ).toThrow(/موجود نیست/);
  });
});
