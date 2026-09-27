import { useEffect, useMemo, useState } from 'react';
import type { DailyTargets, MenuItemDto } from '@prochia/shared';
import {
  ALLERGEN_LABELS,
  ITEM_TAG_LABELS,
  addNutrition,
  formatNumber,
  formatToman,
  roundNutrition,
} from '@prochia/shared';
import { Button, MacroBar, MacroLegend, NutritionLabel, Sheet, Tag, useToast } from '@prochia/ui';
import { useCart } from '../lib/cart';
import { track } from '../lib/track';
import { FoodThumb } from './FoodThumb';
import { Stepper } from './Stepper';
import { unitPrice } from './useCartTotal';

function defaultSelection(item: MenuItemDto): Record<string, string[]> {
  return Object.fromEntries(
    item.groups.map((g) => [
      g.id,
      g.options
        .filter((o) => o.isDefault && o.available)
        .slice(0, g.maxSelect)
        .map((o) => o.id),
    ]),
  );
}

export function ItemSheet({
  item,
  isCafe,
  stationLabel,
  targets,
  onClose,
}: {
  item: MenuItemDto | null;
  isCafe: boolean;
  stationLabel?: string;
  targets: DailyTargets | null;
  onClose: () => void;
}) {
  const cart = useCart();
  const toast = useToast();
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (!item) return;
    setSelection(defaultSelection(item));
    setQuantity(1);
    track('item_view', { item: item.id });
  }, [item]);

  const optionIds = useMemo(() => Object.values(selection).flat(), [selection]);
  const nutrition = useMemo(() => {
    if (!item) return null;
    let n = item.nutrition;
    for (const g of item.groups)
      for (const o of g.options) if (optionIds.includes(o.id)) n = addNutrition(n, o.nutrition);
    return roundNutrition(n);
  }, [item, optionIds]);

  if (!item || !nutrition)
    return (
      <Sheet open={false} onClose={onClose}>
        {null}
      </Sheet>
    );

  const missing = item.groups.filter((g) => (selection[g.id]?.length ?? 0) < g.minSelect);
  const price = unitPrice(item, optionIds);

  const toggle = (groupId: string, optionId: string) => {
    const group = item.groups.find((g) => g.id === groupId)!;
    setSelection((current) => {
      const chosen = current[groupId] ?? [];
      if (group.maxSelect === 1) {
        // Required single choice behaves like a radio; optional single choice can be cleared.
        if (chosen[0] === optionId)
          return group.minSelect > 0 ? current : { ...current, [groupId]: [] };
        return { ...current, [groupId]: [optionId] };
      }
      if (chosen.includes(optionId))
        return { ...current, [groupId]: chosen.filter((id) => id !== optionId) };
      if (chosen.length >= group.maxSelect) return current;
      return { ...current, [groupId]: [...chosen, optionId] };
    });
  };

  const add = () => {
    cart.add(item, optionIds, quantity);
    toast(`${item.name} به سبد اضافه شد`, 'success');
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={item.name}
      footer={
        <div className="sheet-footer">
          <Stepper value={quantity} onChange={setQuantity} min={1} />
          <Button variant="primary" size="l" block disabled={missing.length > 0} onClick={add}>
            افزودن · {formatToman(price * quantity)}
          </Button>
        </div>
      }
    >
      <div className="stack-l">
        <FoodThumb item={item} large isCafe={isCafe} />
        <div className="stack">
          {item.description && <p className="muted">{item.description}</p>}
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {stationLabel && <Tag tone="ink">{stationLabel}</Tag>}
            {item.tags.map((t) => (
              <Tag key={t} tone={t === 'high_protein' ? 'green' : undefined}>
                {ITEM_TAG_LABELS[t]}
              </Tag>
            ))}
          </div>
          {item.allergens.length > 0 && (
            <p className="page-sub">
              <b>حاوی:</b> {item.allergens.map((a) => ALLERGEN_LABELS[a]).join('، ')}
            </p>
          )}
          <div className="stack" style={{ gap: 6 }}>
            <MacroBar nutrition={nutrition} />
            <MacroLegend nutrition={nutrition} />
          </div>
        </div>

        {item.groups.map((g) => (
          <fieldset key={g.id} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="section-title" style={{ marginBottom: 0 }}>
              {g.name}
              <small>
                {g.minSelect > 0
                  ? 'انتخاب کنید'
                  : `اختیاری${g.maxSelect > 1 ? ` — تا ${formatNumber(g.maxSelect)} مورد` : ''}`}
              </small>
            </legend>
            {g.options
              .filter((o) => o.isActive)
              .map((o) => {
                const checked = selection[g.id]?.includes(o.id) ?? false;
                const proteinDelta = Math.round(o.nutrition.protein);
                return (
                  <label key={o.id} className="opt" aria-disabled={!o.available}>
                    <input
                      type={g.maxSelect === 1 && g.minSelect > 0 ? 'radio' : 'checkbox'}
                      name={g.id}
                      checked={checked}
                      disabled={!o.available}
                      onChange={() => toggle(g.id, o.id)}
                    />
                    <span className="opt__name">
                      {o.name}
                      {(proteinDelta !== 0 || o.nutrition.kcal !== 0) && (
                        <small className="num">
                          {proteinDelta !== 0 &&
                            `${proteinDelta > 0 ? '+' : '−'}${formatNumber(Math.abs(proteinDelta))} گرم پروتئین · `}
                          {o.nutrition.kcal >= 0 ? '+' : '−'}
                          {formatNumber(Math.abs(Math.round(o.nutrition.kcal)))} کالری
                        </small>
                      )}
                    </span>
                    <span className="num" style={{ fontWeight: 700, fontSize: 'var(--text-s)' }}>
                      {!o.available
                        ? 'تمام شد'
                        : o.priceDelta > 0
                          ? `+${formatToman(o.priceDelta)}`
                          : 'بدون هزینه'}
                    </span>
                  </label>
                );
              })}
          </fieldset>
        ))}

        <NutritionLabel nutrition={nutrition} servingGrams={item.servingGrams} targets={targets} />
      </div>
    </Sheet>
  );
}
