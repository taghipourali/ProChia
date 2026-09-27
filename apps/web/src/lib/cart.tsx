import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { MenuItemDto } from '@prochia/shared';
import { branchKey } from './branch';
import { storage } from './storage';
import { track } from './track';

export interface CartLine {
  key: string;
  itemId: string;
  optionIds: string[];
  quantity: number;
  note?: string;
}

export interface TableContext {
  code: string;
  label: string;
}

interface CartState {
  lines: CartLine[];
  count: number;
  table: TableContext | null;
  add: (item: MenuItemDto, optionIds: string[], quantity?: number, note?: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
  setTable: (table: TableContext | null) => void;
  quantityOf: (itemId: string) => number;
}

const CartContext = createContext<CartState | null>(null);
const CART_KEY = `prochia.cart.${branchKey}`;
const TABLE_KEY = `prochia.table.${branchKey}`;

const lineKey = (itemId: string, optionIds: string[], note?: string) =>
  [itemId, ...[...optionIds].sort(), note ?? ''].join('|');

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => storage.get<CartLine[]>(CART_KEY, []));
  // The table lives in session storage: scanning a QR ties this visit, not future ones, to a table.
  const [table, setTableState] = useState<TableContext | null>(() =>
    storage.get<TableContext | null>(TABLE_KEY, null, true),
  );

  useEffect(() => storage.set(CART_KEY, lines), [lines]);

  const add = useCallback((item: MenuItemDto, optionIds: string[], quantity = 1, note?: string) => {
    const key = lineKey(item.id, optionIds, note);
    setLines((current) => {
      const existing = current.find((l) => l.key === key);
      if (existing)
        return current.map((l) =>
          l.key === key ? { ...l, quantity: Math.min(l.quantity + quantity, 20) } : l,
        );
      return [...current, { key, itemId: item.id, optionIds, quantity, note }];
    });
    track('add_to_cart', { item: item.id, quantity });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((l) => l.key !== key)
        : current.map((l) => (l.key === key ? { ...l, quantity: Math.min(quantity, 20) } : l)),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const setTable = useCallback((next: TableContext | null) => {
    setTableState(next);
    if (next) storage.set(TABLE_KEY, next, true);
    else storage.remove(TABLE_KEY, true);
  }, []);

  const value = useMemo<CartState>(
    () => ({
      lines,
      count: lines.reduce((s, l) => s + l.quantity, 0),
      table,
      add,
      setQuantity,
      clear,
      setTable,
      quantityOf: (itemId) =>
        lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.quantity, 0),
    }),
    [lines, table, add, setQuantity, clear, setTable],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart outside CartProvider');
  return ctx;
}
