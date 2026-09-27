import type { Unit } from '@prochia/shared';
import { UNIT_BULK, UNIT_LABELS, formatNumber } from '@prochia/shared';

/** "۱٫۲ کیلوگرم" / "۳۵۰ گرم" / "۱۲ عدد" — the unit people think in for that amount. */
export function formatQty(qty: number, unit: Unit) {
  const bulk = UNIT_BULK[unit];
  if (bulk.factor > 1 && Math.abs(qty) >= bulk.factor)
    return `${formatNumber(qty / bulk.factor, 2)} ${bulk.label}`;
  return `${formatNumber(qty, qty % 1 ? 1 : 0)} ${UNIT_LABELS[unit]}`;
}

export const bulkLabel = (unit: Unit) => UNIT_BULK[unit].label;
export const bulkFactor = (unit: Unit) => UNIT_BULK[unit].factor;
