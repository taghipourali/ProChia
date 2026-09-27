import { useMemo } from 'react';
import type { MenuItemDto } from '@prochia/shared';
import { useCart } from '../lib/cart';
import { useMenu } from '../lib/queries';

/** Menu items by id, for pricing and naming cart lines on the client. */
export function useItemIndex() {
  const menu = useMenu();
  return useMemo(() => {
    const map = new Map<string, MenuItemDto>();
    for (const c of menu.data?.categories ?? []) for (const i of c.items) map.set(i.id, i);
    return map;
  }, [menu.data]);
}

export function unitPrice(item: MenuItemDto, optionIds: string[]) {
  let price = item.price;
  for (const g of item.groups)
    for (const o of g.options) if (optionIds.includes(o.id)) price += o.priceDelta;
  return price;
}

/** Pre-discount total shown on the cart bar; the server quote is authoritative at checkout. */
export function useCartTotal(): number | null {
  const { lines } = useCart();
  const items = useItemIndex();
  if (!items.size) return null;
  return lines.reduce((sum, l) => {
    const item = items.get(l.itemId);
    return item ? sum + unitPrice(item, l.optionIds) * l.quantity : sum;
  }, 0);
}
