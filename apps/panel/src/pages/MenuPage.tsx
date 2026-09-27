import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Allergen,
  ItemTag,
  MenuItemDto,
  MenuItemInput,
  Nutrition,
  StaffMenuDto,
  StockLevelDto,
} from '@prochia/shared';
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  ITEM_TAGS,
  ITEM_TAG_LABELS,
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  formatNumber,
  formatToman,
  toFaDigits,
} from '@prochia/shared';
import { Button, Chip, Field, Icon, MacroLine, Tag, useToast } from '@prochia/ui';
import { Drawer, NumberInput, Page, Panel, Switch, Tabs } from '../components/kit';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { assetUrl } from '../lib/session';
import { formatQty } from '../lib/units';

type Tab = 'items' | 'modifiers';
const EMPTY_N: Nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 };

export function MenuPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('items');
  const [editing, setEditing] = useState<MenuItemDto | 'new' | null>(null);
  const [newCategory, setNewCategory] = useState(false);
  const menu = useQuery({ queryKey: ['menu'], queryFn: () => api<StaffMenuDto>('/staff/menu') });
  const stations = new Map((menu.data?.stations ?? []).map((s) => [s.id, s]));

  const availability = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      api(`/staff/items/${id}/availability`, { method: 'PUT', body: { isAvailable } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['menu'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Page
      title="منو و دستور پخت"
      subtitle="قیمت، ارزش غذایی و دستور پخت هر آیتم. موجود بودن آیتم‌ها از روی انبار هم خودکار حساب می‌شود."
      actions={
        auth.can('menu.edit') && (
          <>
            <Button onClick={() => setNewCategory(true)}>دسته‌بندی جدید</Button>
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              آیتم جدید
            </Button>
          </>
        )
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'items', label: 'آیتم‌ها' },
          { value: 'modifiers', label: 'گزینه‌ها (سایز، پروتئین اضافه…)' },
        ]}
      />
      {tab === 'items' && (
        <div className="stack" style={{ gap: 'var(--space-4)' }}>
          {menu.data?.categories.map((c) => (
            <Panel
              key={c.id}
              flush
              title={
                <span>
                  {c.name} <span className="hint">· {stations.get(c.stationId)?.name}</span>{' '}
                  {!c.isActive && <Tag>غیرفعال</Tag>}
                </span>
              }
            >
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 56 }} />
                    <th>نام</th>
                    <th>ارزش غذایی</th>
                    <th className="n">قیمت</th>
                    <th>دستور پخت</th>
                    <th>انبار</th>
                    <th>موجود</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((i) => {
                    const recipe = menu.data!.recipes[i.id] ?? [];
                    return (
                      <tr
                        key={i.id}
                        className="clickable"
                        onClick={() => auth.can('menu.edit') && setEditing(i)}
                        style={i.isPublished ? undefined : { opacity: 0.55 }}
                      >
                        <td>
                          {i.imageUrl ? (
                            <img
                              src={assetUrl(i.imageUrl)!}
                              alt=""
                              style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }}
                            />
                          ) : (
                            <span
                              className="hint"
                              style={{
                                display: 'grid',
                                placeItems: 'center',
                                width: 44,
                                height: 44,
                                background: 'var(--surface-2)',
                                borderRadius: 6,
                              }}
                            >
                              <Icon
                                name={stations.get(i.stationId)?.isAcceptance ? 'bowl' : 'cup'}
                                size={18}
                              />
                            </span>
                          )}
                        </td>
                        <td>
                          <b>{i.name}</b> {!i.isPublished && <Tag>مخفی</Tag>}
                          <div className="hint">
                            {i.tags.map((t) => ITEM_TAG_LABELS[t]).join('، ')}
                          </div>
                        </td>
                        <td>
                          <MacroLine nutrition={i.nutrition} />
                          <div className="hint">
                            {i.nutritionSource === 'recipe' ? 'محاسبه از دستور پخت' : 'ورود دستی'}
                          </div>
                        </td>
                        <td className="n">{formatToman(i.price)}</td>
                        <td className="hint">
                          {recipe.length ? (
                            `${toFaDigits(recipe.length)} ماده`
                          ) : (
                            <Tag tone="warning">ندارد</Tag>
                          )}
                        </td>
                        <td>
                          {!i.stockTracked ? (
                            <span className="hint">—</span>
                          ) : i.portionsLeft !== null ? (
                            <Tag tone={i.portionsLeft === 0 ? 'danger' : 'warning'}>
                              {toFaDigits(i.portionsLeft)} پرس
                            </Tag>
                          ) : (
                            <Tag tone="green">کافی</Tag>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {auth.can('menu.availability') && (
                            <Switch
                              checked={i.isAvailable}
                              onChange={(v) => availability.mutate({ id: i.id, isAvailable: v })}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          ))}
        </div>
      )}
      {tab === 'modifiers' && menu.data && <Modifiers menu={menu.data} />}
      {editing && menu.data && (
        <ItemDrawer
          menu={menu.data}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {newCategory && menu.data && (
        <CategoryDrawer menu={menu.data} onClose={() => setNewCategory(false)} />
      )}
    </Page>
  );
}

function CategoryDrawer({ menu, onClose }: { menu: StaffMenuDto; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [stationId, setStationId] = useState(menu.stations[0]?.id ?? '');
  const save = useMutation({
    mutationFn: () =>
      api('/staff/categories', {
        method: 'POST',
        body: { name, stationId, sort: menu.categories.length, isActive: true },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['menu'] });
      toast('دسته‌بندی ساخته شد', 'success');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      title="دسته‌بندی جدید"
      width={440}
      footer={
        <Button
          variant="primary"
          disabled={!name}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          ذخیره
        </Button>
      }
    >
      <div className="stack">
        <Field label="نام">
          <input className="pc-input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ایستگاه پیش‌فرض">
          <select
            className="pc-input"
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
          >
            {menu.stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Drawer>
  );
}

function ItemDrawer({
  menu,
  item,
  onClose,
}: {
  menu: StaffMenuDto;
  item: MenuItemDto | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const ingredients = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api<StockLevelDto[]>('/staff/inventory'),
  });
  const firstCat = menu.categories[0];
  const [form, setForm] = useState<MenuItemInput>(() => ({
    categoryId: item?.categoryId ?? firstCat?.id ?? '',
    stationId: item?.stationId ?? firstCat?.stationId ?? '',
    name: item?.name ?? '',
    description: item?.description ?? null,
    price: item?.price ?? 0,
    tags: item?.tags ?? [],
    allergens: item?.allergens ?? [],
    nutrition: item?.nutrition ?? EMPTY_N,
    servingGrams: item?.servingGrams ?? null,
    nutritionSource: item?.nutritionSource ?? 'recipe',
    prepMinutes: item?.prepMinutes ?? 10,
    isPublished: item?.isPublished ?? true,
    creditEligible: item?.creditEligible ?? true,
    sort: 0,
    groupIds: item?.groups.map((g) => g.id) ?? [],
  }));
  const [recipe, setRecipe] = useState<{ ingredientId: string; quantity: number | null }[]>(
    (item ? menu.recipes[item.id] : null)?.map((r) => ({ ...r })) ?? [],
  );
  const set = <K extends keyof MenuItemInput>(k: K, v: MenuItemInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const ingById = useMemo(
    () => new Map((ingredients.data ?? []).map((i) => [i.id, i])),
    [ingredients.data],
  );
  const cleanRecipe = recipe
    .filter((r) => r.ingredientId && r.quantity)
    .map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity! }));

  const preview = useQuery({
    queryKey: ['recipe-nutrition', cleanRecipe],
    queryFn: () =>
      api<{ nutrition: Nutrition; missing: string[]; grams: number }>('/staff/recipes/nutrition', {
        method: 'POST',
        body: { lines: cleanRecipe },
      }),
    enabled: cleanRecipe.length > 0,
  });
  const cost = cleanRecipe.reduce(
    (s, r) => s + r.quantity * (ingById.get(r.ingredientId)?.avgCost ?? 0),
    0,
  );

  const save = useMutation({
    mutationFn: async () => {
      const body =
        form.nutritionSource === 'recipe' && preview.data
          ? { ...form, nutrition: preview.data.nutrition }
          : form;
      const { id } = await api<{ id: string }>(item ? `/staff/items/${item.id}` : '/staff/items', {
        method: item ? 'PUT' : 'POST',
        body,
      });
      await api(`/staff/items/${id}/recipe`, { method: 'PUT', body: { lines: cleanRecipe } });
      return id;
    },
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['menu'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const upload = useMutation({
    mutationFn: (file: File) =>
      api<{ imageUrl: string }>(`/staff/items/${item!.id}/image`, { method: 'PUT', raw: file }),
    onSuccess: () => {
      toast('عکس بارگذاری شد', 'success');
      void client.invalidateQueries({ queryKey: ['menu'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const toggle = <T extends string>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <Drawer
      open
      onClose={onClose}
      width={760}
      title={item ? item.name : 'آیتم جدید'}
      footer={
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!form.name || !form.categoryId}
          onClick={() => save.mutate()}
        >
          ذخیره
        </Button>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-5)' }}>
        <div className="form-grid">
          <Field label="نام">
            <input
              className="pc-input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="قیمت (تومان)">
            <NumberInput value={form.price} onChange={(v) => set('price', v ?? 0)} />
          </Field>
          <Field label="دسته‌بندی">
            <select
              className="pc-input"
              value={form.categoryId}
              onChange={(e) => {
                const cat = menu.categories.find((c) => c.id === e.target.value);
                setForm((f) => ({
                  ...f,
                  categoryId: e.target.value,
                  stationId: cat?.stationId ?? f.stationId,
                }));
              }}
            >
              {menu.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ایستگاه آماده‌سازی">
            <select
              className="pc-input"
              value={form.stationId}
              onChange={(e) => set('stationId', e.target.value)}
            >
              {menu.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {[s.name, s.floorLabel].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="زمان آماده‌سازی (دقیقه)">
            <NumberInput value={form.prepMinutes} onChange={(v) => set('prepMinutes', v ?? 0)} />
          </Field>
          <Field label="توضیح" hint="یک جمله؛ مواد اصلی و حس غذا">
            <textarea
              className="pc-input"
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value || null)}
            />
          </Field>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-5)' }}>
          <Switch
            checked={form.isPublished}
            onChange={(v) => set('isPublished', v)}
            label="نمایش در منو"
          />
          <Switch
            checked={form.creditEligible}
            onChange={(v) => set('creditEligible', v)}
            label="قابل پرداخت با اعتبار بسته"
          />
        </div>

        {item && (
          <div className="row">
            {item.imageUrl && (
              <img
                src={assetUrl(item.imageUrl)!}
                alt=""
                style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6 }}
              />
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
            />
            <Button
              icon="upload"
              loading={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {item.imageUrl ? 'تغییر عکس' : 'بارگذاری عکس'}
            </Button>
            <span className="hint">
              تا عکس اضافه نشده، مشتری عدد پروتئین را به جای عکس می‌بیند.
            </span>
          </div>
        )}

        <Panel title="دستور پخت (برای کسر خودکار از انبار)">
          <div className="stack">
            {recipe.map((r, idx) => {
              const ing = ingById.get(r.ingredientId);
              return (
                <div key={idx} className="recipe-row">
                  <select
                    className="pc-input"
                    value={r.ingredientId}
                    onChange={(e) =>
                      setRecipe((xs) =>
                        xs.map((x, i) => (i === idx ? { ...x, ingredientId: e.target.value } : x)),
                      )
                    }
                  >
                    <option value="">انتخاب ماده</option>
                    {(ingredients.data ?? [])
                      .filter((i) => i.isActive)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                  </select>
                  <NumberInput
                    value={r.quantity}
                    onChange={(v) =>
                      setRecipe((xs) => xs.map((x, i) => (i === idx ? { ...x, quantity: v } : x)))
                    }
                    aria-label={ing ? `مقدار (${ing.unit})` : 'مقدار'}
                  />
                  <Button
                    iconOnly
                    variant="ghost"
                    aria-label="حذف"
                    onClick={() => setRecipe((xs) => xs.filter((_, i) => i !== idx))}
                  >
                    <Icon name="trash" size={16} />
                  </Button>
                </div>
              );
            })}
            <div className="row-between">
              <Button
                icon="plus"
                variant="ghost"
                onClick={() => setRecipe((xs) => [...xs, { ingredientId: '', quantity: null }])}
              >
                افزودن ماده
              </Button>
              <span className="hint">مقادیر به گرم / میلی‌لیتر / عدد</span>
            </div>
            {cleanRecipe.length > 0 && (
              <div className="notice">
                <div className="stack" style={{ gap: 4 }}>
                  <span>
                    بهای مواد: <b>{formatToman(Math.round(cost))}</b>
                    {form.price > 0 &&
                      ` — ${toFaDigits(Math.round((cost / form.price) * 100))}٪ قیمت فروش`}
                  </span>
                  {preview.data && (
                    <span>
                      از روی دستور: <MacroLine nutrition={preview.data.nutrition} /> · حدود{' '}
                      {formatNumber(preview.data.grams)} گرم
                    </span>
                  )}
                  {preview.data?.missing.length ? (
                    <span className="hint">
                      ارزش غذایی این مواد ثبت نشده: {preview.data.missing.join('، ')}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="ارزش غذایی هر وعده">
          <div className="stack">
            <Switch
              checked={form.nutritionSource === 'recipe'}
              onChange={(v) => set('nutritionSource', v ? 'recipe' : 'manual')}
              label="محاسبه خودکار از دستور پخت"
            />
            {form.nutritionSource === 'manual' && (
              <div
                className="form-grid"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}
              >
                {NUTRIENT_KEYS.map((k) => (
                  <Field
                    key={k}
                    label={`${NUTRIENT_LABELS[k]}${k === 'sodium' ? ' (mg)' : k === 'kcal' ? '' : ' (g)'}`}
                  >
                    <NumberInput
                      value={form.nutrition[k]}
                      onChange={(v) => set('nutrition', { ...form.nutrition, [k]: v ?? 0 })}
                    />
                  </Field>
                ))}
                <Field label="وزن وعده (g)">
                  <NumberInput value={form.servingGrams} onChange={(v) => set('servingGrams', v)} />
                </Field>
              </div>
            )}
          </div>
        </Panel>

        <Field label="برچسب‌ها">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {ITEM_TAGS.map((t) => (
              <Chip
                key={t}
                pressed={form.tags.includes(t)}
                onClick={() => set('tags', toggle<ItemTag>(form.tags, t))}
              >
                {ITEM_TAG_LABELS[t]}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="حساسیت‌زاها">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {ALLERGENS.map((a) => (
              <Chip
                key={a}
                pressed={form.allergens.includes(a)}
                onClick={() => set('allergens', toggle<Allergen>(form.allergens, a))}
              >
                {ALLERGEN_LABELS[a]}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="گروه‌های گزینه">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {menu.modifierGroups.map((g) => (
              <Chip
                key={g.id}
                pressed={form.groupIds.includes(g.id)}
                onClick={() => set('groupIds', toggle(form.groupIds, g.id))}
              >
                {g.name}
              </Chip>
            ))}
          </div>
        </Field>
        {item?.groups.length ? (
          <p className="hint">دستور پخت هر گزینه در تب «گزینه‌ها» تنظیم می‌شود.</p>
        ) : null}
      </div>
    </Drawer>
  );
}

function Modifiers({ menu }: { menu: StaffMenuDto }) {
  const auth = useAuth();
  const [editing, setEditing] = useState<StaffMenuDto['modifierGroups'][number] | 'new' | null>(
    null,
  );
  const ingredients = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api<StockLevelDto[]>('/staff/inventory'),
  });
  const ingById = new Map((ingredients.data ?? []).map((i) => [i.id, i]));
  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      {auth.can('menu.edit') && (
        <div>
          <Button icon="plus" onClick={() => setEditing('new')}>
            گروه گزینه جدید
          </Button>
        </div>
      )}
      <div className="grid-2">
        {menu.modifierGroups.map((g) => (
          <Panel
            key={g.id}
            title={
              <span>
                {g.name}{' '}
                <span className="hint">
                  {g.minSelect ? 'اجباری' : 'اختیاری'} · حداکثر {toFaDigits(g.maxSelect)}
                </span>
              </span>
            }
            actions={
              auth.can('menu.edit') && (
                <Button size="s" variant="ghost" onClick={() => setEditing(g)}>
                  ویرایش
                </Button>
              )
            }
          >
            <div className="stack" style={{ gap: 6 }}>
              {g.options.map((o) => (
                <div key={o.id} className="row-between" style={{ opacity: o.isActive ? 1 : 0.5 }}>
                  <span>
                    {o.name} {o.isDefault && <Tag>پیش‌فرض</Tag>}
                    <div className="hint">
                      {o.recipe.length
                        ? o.recipe
                            .map(
                              (r) =>
                                `${r.quantity > 0 ? '+' : '−'}${ingById.get(r.ingredientId) ? formatQty(Math.abs(r.quantity), ingById.get(r.ingredientId)!.unit) : ''} ${ingById.get(r.ingredientId)?.name ?? ''}`,
                            )
                            .join('، ')
                        : 'بدون تغییر مواد'}
                    </div>
                  </span>
                  <span className="num">
                    {o.priceDelta ? `+${formatToman(o.priceDelta)}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      {editing && (
        <ModifierDrawer
          group={editing === 'new' ? null : editing}
          ingredients={ingredients.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

type GroupDto = StaffMenuDto['modifierGroups'][number];

function ModifierDrawer({
  group,
  ingredients,
  onClose,
}: {
  group: GroupDto | null;
  ingredients: StockLevelDto[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? '');
  const [minSelect, setMin] = useState<number | null>(group?.minSelect ?? 0);
  const [maxSelect, setMax] = useState<number | null>(group?.maxSelect ?? 1);
  const [options, setOptions] = useState(
    group?.options.map((o) => ({
      ...o,
      recipe: o.recipe.map((r) => ({ ...r, quantity: r.quantity as number | null })),
    })) ?? [
      {
        id: '',
        groupId: '',
        name: '',
        priceDelta: 0,
        nutrition: EMPTY_N,
        isDefault: false,
        isActive: true,
        sort: 0,
        recipe: [] as { ingredientId: string; quantity: number | null }[],
      },
    ],
  );
  const save = useMutation({
    mutationFn: async () => {
      const { id } = await api<{ id: string }>(
        group ? `/staff/modifier-groups/${group.id}` : '/staff/modifier-groups',
        {
          method: group ? 'PUT' : 'POST',
          body: {
            name,
            minSelect: minSelect ?? 0,
            maxSelect: maxSelect ?? 1,
            sort: 0,
            options: options.map((o, i) => ({
              id: o.id || undefined,
              name: o.name,
              priceDelta: o.priceDelta,
              nutrition: o.nutrition,
              isDefault: o.isDefault,
              isActive: o.isActive,
              sort: i,
            })),
          },
        },
      );
      // Option recipes are saved per option once the options have ids.
      const fresh = await api<StaffMenuDto>('/staff/menu');
      const saved = fresh.modifierGroups.find((g) => g.id === id)?.options ?? [];
      for (const o of options) {
        const target = saved.find((s) => (o.id ? s.id === o.id : s.name === o.name));
        if (!target) continue;
        const lines = o.recipe
          .filter((r) => r.ingredientId && r.quantity)
          .map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity! }));
        await api(`/staff/options/${target.id}/recipe`, { method: 'PUT', body: { lines } });
      }
    },
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['menu'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const update = (idx: number, patch: Partial<(typeof options)[number]>) =>
    setOptions((xs) => xs.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  return (
    <Drawer
      open
      onClose={onClose}
      width={760}
      title={group ? group.name : 'گروه گزینه جدید'}
      footer={
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!name || !options.some((o) => o.name)}
          onClick={() => save.mutate()}
        >
          ذخیره
        </Button>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div className="form-grid">
          <Field label="نام گروه">
            <input
              className="pc-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="پروتئین اضافه"
            />
          </Field>
          <Field label="حداقل انتخاب" hint="۰ یعنی اختیاری">
            <NumberInput value={minSelect} onChange={setMin} />
          </Field>
          <Field label="حداکثر انتخاب">
            <NumberInput value={maxSelect} onChange={setMax} />
          </Field>
        </div>
        {options.map((o, idx) => (
          <Panel
            key={idx}
            title={o.name || `گزینه ${toFaDigits(idx + 1)}`}
            actions={
              <Button
                size="s"
                variant="ghost"
                onClick={() => update(idx, { isActive: !o.isActive })}
              >
                {o.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
              </Button>
            }
          >
            <div className="stack">
              <div className="form-grid">
                <Field label="نام">
                  <input
                    className="pc-input"
                    value={o.name}
                    onChange={(e) => update(idx, { name: e.target.value })}
                  />
                </Field>
                <Field label="قیمت اضافه (تومان)">
                  <NumberInput
                    value={o.priceDelta}
                    onChange={(v) => update(idx, { priceDelta: v ?? 0 })}
                  />
                </Field>
                <Switch
                  checked={o.isDefault}
                  onChange={(v) => update(idx, { isDefault: v })}
                  label="پیش‌فرض"
                />
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
                  <Field key={k} label={`${NUTRIENT_LABELS[k]} ±`}>
                    <NumberInput
                      value={o.nutrition[k]}
                      onChange={(v) => update(idx, { nutrition: { ...o.nutrition, [k]: v ?? 0 } })}
                    />
                  </Field>
                ))}
              </div>
              <b className="hint">
                تغییر مواد (منفی برای جایگزینی، مثلاً ۲۰۰− شیر و ۲۰۰+ شیر بادام)
              </b>
              {o.recipe.map((r, ri) => (
                <div key={ri} className="recipe-row">
                  <select
                    className="pc-input"
                    value={r.ingredientId}
                    onChange={(e) =>
                      update(idx, {
                        recipe: o.recipe.map((x, i) =>
                          i === ri ? { ...x, ingredientId: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    <option value="">ماده</option>
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                  <NumberInput
                    value={r.quantity}
                    onChange={(v) =>
                      update(idx, {
                        recipe: o.recipe.map((x, i) => (i === ri ? { ...x, quantity: v } : x)),
                      })
                    }
                  />
                  <Button
                    iconOnly
                    variant="ghost"
                    aria-label="حذف"
                    onClick={() => update(idx, { recipe: o.recipe.filter((_, i) => i !== ri) })}
                  >
                    <Icon name="trash" size={16} />
                  </Button>
                </div>
              ))}
              <Button
                size="s"
                variant="ghost"
                icon="plus"
                onClick={() =>
                  update(idx, { recipe: [...o.recipe, { ingredientId: '', quantity: null }] })
                }
              >
                ماده
              </Button>
            </div>
          </Panel>
        ))}
        <Button
          icon="plus"
          onClick={() =>
            setOptions((xs) => [
              ...xs,
              {
                id: '',
                groupId: '',
                name: '',
                priceDelta: 0,
                nutrition: EMPTY_N,
                isDefault: false,
                isActive: true,
                sort: xs.length,
                recipe: [],
              },
            ])
          }
        >
          گزینه جدید
        </Button>
      </div>
    </Drawer>
  );
}
