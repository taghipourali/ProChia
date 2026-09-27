import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ItemTag, MenuItemDto } from '@prochia/shared';
import { Chip, Empty, Icon, Segmented, Skeleton } from '@prochia/ui';
import { ItemRow } from '../components/ItemRow';
import { ItemSheet } from '../components/ItemSheet';
import { Suggestions } from '../components/Suggestions';
import { useCart } from '../lib/cart';
import { useMember, useMenu } from '../lib/queries';
import { track } from '../lib/track';

type Filter =
  | 'high_protein'
  | 'low_carb'
  | 'vegetarian'
  | 'pre_workout'
  | 'post_workout'
  | 'gluten_free'
  | 'safe';
type Sort = 'default' | 'protein' | 'kcal' | 'density';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'high_protein', label: 'پرپروتئین' },
  { key: 'post_workout', label: 'بعد تمرین' },
  { key: 'pre_workout', label: 'قبل تمرین' },
  { key: 'low_carb', label: 'کم‌کربو' },
  { key: 'vegetarian', label: 'گیاهی' },
  { key: 'gluten_free', label: 'بدون گلوتن' },
];

function matches(item: MenuItemDto, filter: Filter, allergens: string[]) {
  if (filter === 'safe') return !item.allergens.some((a) => allergens.includes(a));
  if (filter === 'vegetarian')
    return item.tags.includes('vegan') || item.tags.includes('vegetarian');
  return item.tags.includes(filter as ItemTag);
}

export function MenuPage() {
  const menu = useMenu();
  const { health } = useMember();
  const cart = useCart();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<Sort>('default');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const blocks = useRef(new Map<string, HTMLElement>());

  useEffect(
    () => track('menu_view', cart.table ? { table: cart.table.code } : undefined),
    [cart.table],
  );

  const stations = useMemo(
    () => new Map((menu.data?.stations ?? []).map((s) => [s.id, s])),
    [menu.data],
  );
  const allItems = useMemo(() => menu.data?.categories.flatMap((c) => c.items) ?? [], [menu.data]);
  const openItem = allItems.find((i) => i.id === params.get('item')) ?? null;
  const allergens = health?.allergens ?? [];

  const categories = useMemo(() => {
    if (!menu.data) return [];
    return menu.data.categories
      .map((c) => {
        let items = c.items.filter((i) => filters.every((f) => matches(i, f, allergens)));
        if (sort === 'protein')
          items = [...items].sort((a, b) => b.nutrition.protein - a.nutrition.protein);
        if (sort === 'kcal') items = [...items].sort((a, b) => a.nutrition.kcal - b.nutrition.kcal);
        if (sort === 'density')
          items = [...items].sort(
            (a, b) =>
              b.nutrition.protein / (b.nutrition.kcal || 1) -
              a.nutrition.protein / (a.nutrition.kcal || 1),
          );
        // Sold-out items sink to the bottom of their category.
        items = [...items].sort((a, b) => Number(b.available) - Number(a.available));
        return { ...c, items };
      })
      .filter((c) => c.items.length > 0);
  }, [menu.data, filters, sort, allergens]);

  // Highlight the category tab for the section in view.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveCat(visible.target.getAttribute('data-cat'));
      },
      { rootMargin: '-160px 0px -60% 0px' },
    );
    for (const el of blocks.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [categories]);

  const toggleFilter = (f: Filter) =>
    setFilters((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  const open = (item: MenuItemDto) =>
    setParams((p) => (p.set('item', item.id), p), { replace: false });
  const close = () => setParams((p) => (p.delete('item'), p), { replace: true });
  const stationOf = (item: MenuItemDto) => stations.get(item.stationId);

  return (
    <>
      {cart.table && (
        <div className="notice notice--green" style={{ marginTop: 'var(--space-4)' }}>
          <Icon name="qr" />
          <div style={{ flex: 1 }}>
            <b>{cart.table.label}</b> — سفارش‌ها سر همین میز آورده می‌شود.
          </div>
          <button
            type="button"
            className="pc-btn pc-btn--ghost pc-btn--s"
            onClick={() => cart.setTable(null)}
          >
            تحویل حضوری
          </button>
        </div>
      )}

      <Suggestions onOpen={open} />

      <div className="menu-tools" style={{ marginTop: 'var(--space-4)' }}>
        <div className="scroll-x" style={{ paddingBottom: 'var(--space-2)' }}>
          {health && allergens.length > 0 && (
            <Chip pressed={filters.includes('safe')} onClick={() => toggleFilter('safe')}>
              بدون حساسیت‌زای من
            </Chip>
          )}
          {FILTERS.map((f) => (
            <Chip key={f.key} pressed={filters.includes(f.key)} onClick={() => toggleFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="page-sub" style={{ flex: 'none' }}>
            ترتیب
          </span>
          <Segmented<Sort>
            label="مرتب‌سازی"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'default', label: 'پیش‌فرض' },
              { value: 'protein', label: 'پروتئین' },
              { value: 'density', label: 'پروتئین/کالری' },
              { value: 'kcal', label: 'کم‌کالری' },
            ]}
          />
        </div>
        <nav className="cat-tabs" aria-label="دسته‌بندی‌ها">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className="cat-tab"
              aria-current={activeCat === c.id}
              onClick={() =>
                blocks.current.get(c.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {c.name}
            </button>
          ))}
        </nav>
      </div>

      {menu.isLoading && (
        <div className="stack" style={{ paddingTop: 'var(--space-5)' }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
              <Skeleton width={84} height={84} />
              <div className="stack" style={{ flex: 1, gap: 8 }}>
                <Skeleton height={18} width="70%" />
                <Skeleton height={14} />
                <Skeleton height={14} width="50%" />
              </div>
            </div>
          ))}
        </div>
      )}

      {menu.isError && (
        <Empty icon="alert" title="منو بارگذاری نشد">
          اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.
        </Empty>
      )}

      {menu.data && categories.length === 0 && (
        <Empty icon="filter" title="چیزی با این فیلترها پیدا نشد">
          <button type="button" className="pc-btn pc-btn--s" onClick={() => setFilters([])}>
            حذف فیلترها
          </button>
        </Empty>
      )}

      {categories.map((c) => {
        const station = stations.get(c.stationId);
        return (
          <section
            key={c.id}
            className="cat-block"
            data-cat={c.id}
            ref={(el) => {
              if (el) blocks.current.set(c.id, el);
              else blocks.current.delete(c.id);
            }}
          >
            <div className="cat-block__head">
              <h2>{c.name}</h2>
              {station && (
                <span>{[station.name, station.floorLabel].filter(Boolean).join(' · ')}</span>
              )}
            </div>
            {c.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                isCafe={!stationOf(item)?.isAcceptance}
                memberAllergens={allergens}
                onOpen={() => open(item)}
              />
            ))}
          </section>
        );
      })}

      <ItemSheet
        item={openItem}
        isCafe={openItem ? !stationOf(openItem)?.isAcceptance : false}
        stationLabel={
          openItem
            ? [stationOf(openItem)?.name, stationOf(openItem)?.floorLabel]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        targets={health?.targets ?? null}
        onClose={close}
      />
    </>
  );
}
