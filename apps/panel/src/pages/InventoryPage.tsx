import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Allergen,
  IngredientKind,
  Nutrition,
  PrepRecipeDto,
  StockLevelDto,
  StockMovementDto,
  StockReason,
  Unit,
} from '@prochia/shared';
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  INGREDIENT_KIND_LABELS,
  NUTRIENT_KEYS,
  NUTRIENT_LABELS,
  STOCK_REASON_LABELS,
  UNITS,
  UNIT_LABELS,
  formatDateTime,
  formatNumber,
  formatToman,
  toFaDigits,
} from '@prochia/shared';
import { Button, Chip, Empty, Field, Icon, Money, Segmented, Tag, useToast } from '@prochia/ui';
import { Drawer, Kpi, NumberInput, Page, Panel, Switch, Tabs } from '../components/kit';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { bulkFactor, bulkLabel, formatQty } from '../lib/units';

type Tab = 'levels' | 'purchase' | 'prep' | 'moves' | 'ingredients';

export function InventoryPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('levels');
  const levels = useQuery({
    queryKey: ['inventory'],
    queryFn: () => api<StockLevelDto[]>('/staff/inventory'),
    refetchInterval: 60_000,
  });
  const data = levels.data ?? [];
  const value = data.reduce((s, r) => s + r.value, 0);
  const low = data.filter((r) => r.isActive && r.isLow);

  const tabs: { value: Tab; label: string }[] = [
    { value: 'levels', label: 'موجودی زنده' },
    ...(auth.can('inventory.edit') ? [{ value: 'purchase' as const, label: 'ورود کالا' }] : []),
    { value: 'prep', label: 'فرآوری' },
    { value: 'moves', label: 'گردش انبار' },
    ...(auth.can('inventory.edit') ? [{ value: 'ingredients' as const, label: 'تعریف مواد' }] : []),
  ];

  return (
    <Page
      title="انبار و فرآوری"
      subtitle="هر سفارش تأییدشده، مواد دستور پختش را خودکار از انبار کم می‌کند."
    >
      <div className="kpis" style={{ marginBottom: 'var(--space-4)' }}>
        <Kpi label="ارزش موجودی" value={<Money amount={Math.round(value)} />} />
        <Kpi
          label="اقلام رو به اتمام"
          value={toFaDigits(low.length)}
          hint={
            low
              .slice(0, 3)
              .map((l) => l.name)
              .join('، ') || 'همه کافی است'
          }
        />
        <Kpi
          label="رزرو برای سفارش‌های منتظر"
          value={toFaDigits(data.filter((r) => r.reserved > 0).length)}
          hint="ماده اولیه"
        />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'levels' && <Levels rows={data} />}
      {tab === 'purchase' && <PurchaseForm ingredients={data} onDone={() => setTab('levels')} />}
      {tab === 'prep' && <Processing ingredients={data} />}
      {tab === 'moves' && <Movements ingredients={data} />}
      {tab === 'ingredients' && <Ingredients rows={data} />}
    </Page>
  );
}

function Levels({ rows }: { rows: StockLevelDto[] }) {
  const auth = useAuth();
  const [kind, setKind] = useState<'all' | IngredientKind | 'low'>('all');
  const [q, setQ] = useState('');
  const [adjusting, setAdjusting] = useState<StockLevelDto | null>(null);
  const shown = rows.filter(
    (r) =>
      r.isActive &&
      (kind === 'all' || (kind === 'low' ? r.isLow : r.kind === kind)) &&
      (!q || r.name.includes(q.trim())),
  );
  return (
    <Panel
      flush
      title={
        <div className="row">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'همه' },
              { value: 'raw', label: 'مواد اولیه' },
              { value: 'prepared', label: 'آماده پخت' },
              { value: 'low', label: 'رو به اتمام' },
            ]}
          />
          <input
            className="pc-input"
            style={{ width: 200, minHeight: 38 }}
            placeholder="جستجو"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      }
    >
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>ماده</th>
              <th>نوع</th>
              <th className="n">موجودی</th>
              <th className="n">رزرو سفارش‌ها</th>
              <th className="n">آزاد</th>
              <th className="n">کفایت</th>
              <th className="n">میانگین قیمت</th>
              <th className="n">ارزش</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} style={r.isLow ? { background: 'var(--warning-50)' } : undefined}>
                <td>
                  <b>{r.name}</b> {r.isLow && <Tag tone="warning">کم</Tag>}
                </td>
                <td className="hint">{INGREDIENT_KIND_LABELS[r.kind]}</td>
                <td className="n">{formatQty(r.onHand, r.unit)}</td>
                <td className="n hint">{r.reserved ? formatQty(r.reserved, r.unit) : '—'}</td>
                <td
                  className="n"
                  style={{ fontWeight: 750, color: r.available < 0 ? 'var(--danger)' : undefined }}
                >
                  {formatQty(r.available, r.unit)}
                </td>
                <td className="n">{r.daysLeft === null ? '—' : `${toFaDigits(r.daysLeft)} روز`}</td>
                <td className="n hint">
                  {formatToman(Math.round(r.avgCost * bulkFactor(r.unit)), { unit: false })} /{' '}
                  {bulkLabel(r.unit)}
                </td>
                <td className="n">{formatToman(r.value, { unit: false })}</td>
                <td>
                  {auth.can('inventory.produce') && (
                    <Button size="s" variant="ghost" onClick={() => setAdjusting(r)}>
                      ضایعات / شمارش
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adjusting && <AdjustDrawer row={adjusting} onClose={() => setAdjusting(null)} />}
    </Panel>
  );
}

function AdjustDrawer({ row, onClose }: { row: StockLevelDto; onClose: () => void }) {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const canCount = auth.can('inventory.edit');
  const [reason, setReason] = useState<'waste' | 'adjustment'>('waste');
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const factor = bulkFactor(row.unit);
  const save = useMutation({
    mutationFn: () =>
      api('/staff/stock-adjustments', {
        method: 'POST',
        body:
          reason === 'waste'
            ? { ingredientId: row.id, reason, quantity: (amount ?? 0) * factor, note: note || null }
            : {
                ingredientId: row.id,
                reason,
                countedOnHand: (amount ?? 0) * factor,
                note: note || null,
              },
      }),
    onSuccess: () => {
      toast('ثبت شد', 'success');
      void client.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      title={row.name}
      width={480}
      footer={
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={amount === null || amount < 0}
          onClick={() => save.mutate()}
        >
          ثبت
        </Button>
      }
    >
      <div className="stack">
        <p className="hint">موجودی دفتری: {formatQty(row.onHand, row.unit)}</p>
        {canCount && (
          <Segmented
            value={reason}
            onChange={setReason}
            options={[
              { value: 'waste', label: 'ثبت ضایعات' },
              { value: 'adjustment', label: 'شمارش و اصلاح' },
            ]}
          />
        )}
        <Field
          label={
            reason === 'waste'
              ? `مقدار ضایعات (${bulkLabel(row.unit)})`
              : `موجودی شمارش‌شده (${bulkLabel(row.unit)})`
          }
        >
          <NumberInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="توضیح">
          <input
            className="pc-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={reason === 'waste' ? 'مثلاً فاسد شده' : 'شمارش پایان روز'}
          />
        </Field>
      </div>
    </Drawer>
  );
}

interface PurchaseRow {
  key: number;
  ingredientId: string;
  bulkQty: number | null;
  lineCost: number | null;
}

function PurchaseForm({
  ingredients,
  onDone,
}: {
  ingredients: StockLevelDto[];
  onDone: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const raw = ingredients.filter((i) => i.isActive);
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [rows, setRows] = useState<PurchaseRow[]>([
    { key: 1, ingredientId: '', bulkQty: null, lineCost: null },
  ]);
  const byId = new Map(raw.map((i) => [i.id, i]));
  const valid = rows.filter(
    (r) => r.ingredientId && r.bulkQty && r.bulkQty > 0 && r.lineCost !== null,
  );
  const total = valid.reduce((s, r) => s + (r.lineCost ?? 0), 0);

  const save = useMutation({
    mutationFn: () =>
      api('/staff/purchases', {
        method: 'POST',
        body: {
          supplier: supplier || null,
          invoiceNo: invoice || null,
          lines: valid.map((r) => ({
            ingredientId: r.ingredientId,
            quantity: (r.bulkQty ?? 0) * bulkFactor(byId.get(r.ingredientId)!.unit),
            lineCost: r.lineCost ?? 0,
          })),
        },
      }),
    onSuccess: () => {
      toast('ورود کالا ثبت شد و موجودی به‌روز شد', 'success');
      void client.invalidateQueries({ queryKey: ['inventory'] });
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const update = (key: number, patch: Partial<PurchaseRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
      <Panel title="اقلام فاکتور">
        <div className="stack">
          {rows.map((r) => {
            const ing = byId.get(r.ingredientId);
            return (
              <div key={r.key} className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="ماده">
                  <select
                    className="pc-input"
                    value={r.ingredientId}
                    onChange={(e) => update(r.key, { ingredientId: e.target.value })}
                    style={{ minWidth: 220 }}
                  >
                    <option value="">انتخاب کنید</option>
                    {raw.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({INGREDIENT_KIND_LABELS[i.kind]})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`مقدار (${ing ? bulkLabel(ing.unit) : 'واحد'})`}>
                  <NumberInput value={r.bulkQty} onChange={(v) => update(r.key, { bulkQty: v })} />
                </Field>
                <Field label="مبلغ کل ردیف (تومان)">
                  <NumberInput
                    value={r.lineCost}
                    onChange={(v) => update(r.key, { lineCost: v })}
                  />
                </Field>
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label="حذف ردیف"
                  onClick={() =>
                    setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))
                  }
                >
                  <Icon name="trash" size={18} />
                </Button>
              </div>
            );
          })}
          <Button
            icon="plus"
            variant="ghost"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { key: Date.now(), ingredientId: '', bulkQty: null, lineCost: null },
              ])
            }
          >
            ردیف جدید
          </Button>
        </div>
      </Panel>
      <Panel title="فاکتور">
        <div className="stack">
          <Field label="تأمین‌کننده">
            <input
              className="pc-input"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
          </Field>
          <Field label="شماره فاکتور">
            <input
              className="pc-input"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
            />
          </Field>
          <div
            className="row-between"
            style={{ borderTop: '3px solid var(--ink)', paddingTop: 8, fontWeight: 850 }}
          >
            <span>جمع</span>
            <Money amount={total} />
          </div>
          <Button
            variant="primary"
            size="l"
            loading={save.isPending}
            disabled={!valid.length}
            onClick={() => save.mutate()}
          >
            ثبت ورود به انبار
          </Button>
          <p className="hint">
            میانگین قیمت هر ماده با این خرید به‌روز می‌شود و در بهای تمام‌شده غذاها اثر می‌گذارد.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Processing({ ingredients }: { ingredients: StockLevelDto[] }) {
  const auth = useAuth();
  const recipes = useQuery({
    queryKey: ['prep-recipes'],
    queryFn: () => api<PrepRecipeDto[]>('/staff/prep-recipes'),
  });
  const runs = useQuery({
    queryKey: ['production'],
    queryFn: () =>
      api<
        {
          id: string;
          outputName: string;
          unit: Unit;
          outputQuantity: number;
          totalCost: number;
          staffName: string | null;
          createdAt: string;
        }[]
      >('/staff/production'),
  });
  const [running, setRunning] = useState<PrepRecipeDto | null>(null);
  const [editing, setEditing] = useState<PrepRecipeDto | 'new' | null>(null);
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <div className="row-between">
        <p className="hint">
          مواد اولیه را به مواد آماده پخت تبدیل کنید (مثلاً سینه مرغ خام ← مرغ مرینیت). بازده واقعی
          هر بار ثبت می‌شود.
        </p>
        {auth.can('inventory.edit') && (
          <Button icon="plus" onClick={() => setEditing('new')}>
            دستور فرآوری جدید
          </Button>
        )}
      </div>
      <div className="grid-3">
        {recipes.data?.map((r) => {
          const out = byId.get(r.outputIngredientId);
          return (
            <Panel
              key={r.id}
              title={r.name}
              actions={
                auth.can('inventory.edit') && (
                  <Button
                    size="s"
                    variant="ghost"
                    iconOnly
                    aria-label="ویرایش"
                    onClick={() => setEditing(r)}
                  >
                    <Icon name="edit" size={16} />
                  </Button>
                )
              }
            >
              <div className="stack" style={{ gap: 6 }}>
                {r.inputs.map((i) => {
                  const ing = byId.get(i.ingredientId);
                  return (
                    <div key={i.id} className="row-between hint">
                      <span>{ing?.name}</span>
                      <span className="num">{ing && formatQty(i.quantity, ing.unit)}</span>
                    </div>
                  );
                })}
                <div
                  className="row-between"
                  style={{ borderTop: '2px solid var(--ink)', paddingTop: 6 }}
                >
                  <b>← {out?.name}</b>
                  <b className="num">{out && formatQty(r.outputQuantity, out.unit)}</b>
                </div>
                {out && (
                  <span className="hint">موجودی فعلی: {formatQty(out.onHand, out.unit)}</span>
                )}
                {auth.can('inventory.produce') && (
                  <Button variant="primary" onClick={() => setRunning(r)}>
                    ثبت فرآوری
                  </Button>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
      <Panel title="فرآوری‌های اخیر" flush>
        <table className="data">
          <thead>
            <tr>
              <th>خروجی</th>
              <th className="n">مقدار</th>
              <th className="n">بهای تمام‌شده</th>
              <th>توسط</th>
              <th>زمان</th>
            </tr>
          </thead>
          <tbody>
            {runs.data?.slice(0, 20).map((r) => (
              <tr key={r.id}>
                <td>{r.outputName}</td>
                <td className="n">{formatQty(r.outputQuantity, r.unit)}</td>
                <td className="n">{formatToman(r.totalCost)}</td>
                <td>{r.staffName}</td>
                <td className="num">{formatDateTime(new Date(r.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {running && (
        <RunDrawer recipe={running} ingredients={byId} onClose={() => setRunning(null)} />
      )}
      {editing && (
        <PrepRecipeDrawer
          recipe={editing === 'new' ? null : editing}
          ingredients={ingredients}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RunDrawer({
  recipe,
  ingredients,
  onClose,
}: {
  recipe: PrepRecipeDto;
  ingredients: Map<string, StockLevelDto>;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const out = ingredients.get(recipe.outputIngredientId)!;
  const factor = bulkFactor(out.unit);
  const [batches, setBatches] = useState<number | null>(1);
  const [actual, setActual] = useState<number | null>(recipe.outputQuantity / factor);
  const inputs = recipe.inputs.map((i) => ({ ...i, quantity: i.quantity * (batches ?? 0) }));
  const cost = inputs.reduce(
    (s, i) => s + i.quantity * (ingredients.get(i.ingredientId)?.avgCost ?? 0),
    0,
  );
  const short = inputs.filter((i) => (ingredients.get(i.ingredientId)?.onHand ?? 0) < i.quantity);
  const expected = recipe.outputQuantity * (batches ?? 0);

  const save = useMutation({
    mutationFn: () =>
      api('/staff/production', {
        method: 'POST',
        body: {
          prepRecipeId: recipe.id,
          batches: batches ?? 1,
          outputQuantity: (actual ?? 0) * factor,
        },
      }),
    onSuccess: () => {
      toast('فرآوری ثبت شد', 'success');
      void client.invalidateQueries({ queryKey: ['inventory'] });
      void client.invalidateQueries({ queryKey: ['production'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={recipe.name}
      width={520}
      footer={
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!batches || !actual || short.length > 0}
          onClick={() => save.mutate()}
        >
          ثبت فرآوری
        </Button>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div className="row">
          <Field label="تعداد بچ">
            <NumberInput
              value={batches}
              onChange={(v) => {
                setBatches(v);
                if (v) setActual((recipe.outputQuantity * v) / factor);
              }}
            />
          </Field>
          <Field
            label={`خروجی واقعی (${bulkLabel(out.unit)})`}
            hint={`مورد انتظار: ${formatQty(expected, out.unit)}`}
          >
            <NumberInput value={actual} onChange={setActual} />
          </Field>
        </div>
        <div>
          <b>مصرف از انبار</b>
          {inputs.map((i) => {
            const ing = ingredients.get(i.ingredientId);
            const isShort = short.includes(i);
            return (
              <div
                key={i.id}
                className="row-between"
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid var(--line)',
                  color: isShort ? 'var(--danger)' : undefined,
                }}
              >
                <span>{ing?.name}</span>
                <span className="num">
                  {ing && formatQty(i.quantity, ing.unit)}{' '}
                  {isShort && `(موجود ${ing && formatQty(ing.onHand, ing.unit)})`}
                </span>
              </div>
            );
          })}
        </div>
        <div className="notice">
          <div>
            بهای تمام‌شده این بچ حدود <b>{formatToman(Math.round(cost))}</b>؛ هر{' '}
            {bulkLabel(out.unit)} خروجی{' '}
            <b>{actual ? formatToman(Math.round(cost / actual)) : '—'}</b>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function PrepRecipeDrawer({
  recipe,
  ingredients,
  onClose,
}: {
  recipe: PrepRecipeDto | null;
  ingredients: StockLevelDto[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(recipe?.name ?? '');
  const [output, setOutput] = useState(recipe?.outputIngredientId ?? '');
  const [outQty, setOutQty] = useState<number | null>(recipe?.outputQuantity ?? null);
  const [inputs, setInputs] = useState<{ ingredientId: string; quantity: number | null }[]>(
    recipe?.inputs.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity })) ?? [
      { ingredientId: '', quantity: null },
    ],
  );
  const prepared = ingredients.filter((i) => i.kind === 'prepared');
  const save = useMutation({
    mutationFn: () =>
      api(recipe ? `/staff/prep-recipes/${recipe.id}` : '/staff/prep-recipes', {
        method: recipe ? 'PUT' : 'POST',
        body: {
          name,
          outputIngredientId: output,
          outputQuantity: outQty,
          isActive: true,
          inputs: inputs.filter((i) => i.ingredientId && i.quantity),
        },
      }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['prep-recipes'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      title={recipe ? 'ویرایش دستور فرآوری' : 'دستور فرآوری جدید'}
      footer={
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!name || !output || !outQty}
          onClick={() => save.mutate()}
        >
          ذخیره
        </Button>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <Field label="نام">
          <input
            className="pc-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="تمیز و مرینیت سینه مرغ"
          />
        </Field>
        <div className="row">
          <Field
            label="خروجی (ماده آماده پخت)"
            hint="اگر نیست، ابتدا در «تعریف مواد» با نوع آماده پخت بسازید."
          >
            <select className="pc-input" value={output} onChange={(e) => setOutput(e.target.value)}>
              <option value="">انتخاب کنید</option>
              {prepared.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="خروجی هر بچ (واحد پایه)">
            <NumberInput value={outQty} onChange={setOutQty} />
          </Field>
        </div>
        <b>مواد مصرفی هر بچ (گرم / میلی‌لیتر / عدد)</b>
        {inputs.map((row, idx) => (
          <div key={idx} className="recipe-row">
            <select
              className="pc-input"
              value={row.ingredientId}
              onChange={(e) =>
                setInputs((xs) =>
                  xs.map((x, i) => (i === idx ? { ...x, ingredientId: e.target.value } : x)),
                )
              }
            >
              <option value="">انتخاب ماده</option>
              {ingredients
                .filter((i) => i.id !== output)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
            <NumberInput
              value={row.quantity}
              onChange={(v) =>
                setInputs((xs) => xs.map((x, i) => (i === idx ? { ...x, quantity: v } : x)))
              }
            />
            <Button
              iconOnly
              variant="ghost"
              aria-label="حذف"
              onClick={() => setInputs((xs) => xs.filter((_, i) => i !== idx))}
            >
              <Icon name="trash" size={16} />
            </Button>
          </div>
        ))}
        <Button
          icon="plus"
          variant="ghost"
          onClick={() => setInputs((xs) => [...xs, { ingredientId: '', quantity: null }])}
        >
          افزودن ماده
        </Button>
      </div>
    </Drawer>
  );
}

function Movements({ ingredients }: { ingredients: StockLevelDto[] }) {
  const [ingredientId, setIngredientId] = useState('');
  const [reason, setReason] = useState<StockReason | ''>('');
  const params = new URLSearchParams();
  if (ingredientId) params.set('ingredientId', ingredientId);
  if (reason) params.set('reason', reason);
  params.set('limit', '200');
  const moves = useQuery({
    queryKey: ['inventory', 'moves', ingredientId, reason],
    queryFn: () => api<StockMovementDto[]>(`/staff/stock-movements?${params}`),
  });
  return (
    <Panel
      flush
      title={
        <div className="row">
          <select
            className="pc-input"
            style={{ minHeight: 38, width: 220 }}
            value={ingredientId}
            onChange={(e) => setIngredientId(e.target.value)}
          >
            <option value="">همه مواد</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <select
            className="pc-input"
            style={{ minHeight: 38, width: 200 }}
            value={reason}
            onChange={(e) => setReason(e.target.value as StockReason | '')}
          >
            <option value="">همه علت‌ها</option>
            {Object.entries(STOCK_REASON_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>زمان</th>
              <th>ماده</th>
              <th>علت</th>
              <th className="n">تغییر</th>
              <th className="n">مانده</th>
              <th>توسط</th>
              <th>توضیح</th>
            </tr>
          </thead>
          <tbody>
            {moves.data?.map((m) => (
              <tr key={m.id}>
                <td className="num">{formatDateTime(new Date(m.createdAt))}</td>
                <td>{m.ingredientName}</td>
                <td>{STOCK_REASON_LABELS[m.reason]}</td>
                <td
                  className="n"
                  style={{
                    color: m.delta > 0 ? 'var(--green-700)' : 'var(--danger)',
                    fontWeight: 700,
                  }}
                >
                  {m.delta > 0 ? '+' : '−'}
                  {formatQty(Math.abs(m.delta), m.unit)}
                </td>
                <td className="n">{formatQty(m.balanceAfter, m.unit)}</td>
                <td>{m.staffName ?? (m.refType === 'order' ? 'سفارش' : '—')}</td>
                <td className="hint">{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {moves.data?.length === 0 && <Empty icon="layers" title="گردشی ثبت نشده" />}
      </div>
    </Panel>
  );
}

const emptyNutrition = (): Nutrition => ({
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  sodium: 0,
});

function Ingredients({ rows }: { rows: StockLevelDto[] }) {
  const [editing, setEditing] = useState<StockLevelDto | 'new' | null>(null);
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'fa')),
    [rows],
  );
  return (
    <Panel
      flush
      title="مواد تعریف‌شده"
      actions={
        <Button icon="plus" onClick={() => setEditing('new')}>
          ماده جدید
        </Button>
      }
    >
      <table className="data">
        <thead>
          <tr>
            <th>نام</th>
            <th>نوع</th>
            <th>واحد</th>
            <th>ارزش غذایی (در ۱۰۰)</th>
            <th>حساسیت‌زا</th>
            <th className="n">حد هشدار</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.id}
              className="clickable"
              onClick={() => setEditing(r)}
              style={r.isActive ? undefined : { opacity: 0.5 }}
            >
              <td>
                <b>{r.name}</b>
              </td>
              <td>{INGREDIENT_KIND_LABELS[r.kind]}</td>
              <td>{UNIT_LABELS[r.unit]}</td>
              <td className="hint num">
                {r.nutrition
                  ? `${formatNumber(r.nutrition.kcal)} کالری · پ ${formatNumber(r.nutrition.protein, 1)} · ک ${formatNumber(r.nutrition.carbs, 1)} · چ ${formatNumber(r.nutrition.fat, 1)}`
                  : 'ثبت نشده'}
              </td>
              <td className="hint">{r.allergens.map((a) => ALLERGEN_LABELS[a]).join('، ')}</td>
              <td className="n">{formatQty(r.lowStockThreshold, r.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <IngredientDrawer
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

function IngredientDrawer({ row, onClose }: { row: StockLevelDto | null; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(row?.name ?? '');
  const [kind, setKind] = useState<IngredientKind>(row?.kind ?? 'raw');
  const [unit, setUnit] = useState<Unit>(row?.unit ?? 'g');
  const [hasNutrition, setHasNutrition] = useState(Boolean(row?.nutrition) || !row);
  const [nutrition, setNutrition] = useState<Nutrition>(row?.nutrition ?? emptyNutrition());
  const [allergens, setAllergens] = useState<Allergen[]>(row?.allergens ?? []);
  const [threshold, setThreshold] = useState<number | null>(
    row ? row.lowStockThreshold / bulkFactor(row.unit) : 0,
  );
  const [active, setActive] = useState(row?.isActive ?? true);
  const save = useMutation({
    mutationFn: () =>
      api(row ? `/staff/ingredients/${row.id}` : '/staff/ingredients', {
        method: row ? 'PUT' : 'POST',
        body: {
          name,
          kind,
          unit,
          nutrition: hasNutrition ? nutrition : null,
          allergens,
          lowStockThreshold: (threshold ?? 0) * bulkFactor(unit),
          isActive: active,
        },
      }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Drawer
      open
      onClose={onClose}
      title={row ? row.name : 'ماده جدید'}
      footer={
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={!name.trim()}
          onClick={() => save.mutate()}
        >
          ذخیره
        </Button>
      }
    >
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div className="form-grid">
          <Field label="نام">
            <input className="pc-input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="نوع">
            <select
              className="pc-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as IngredientKind)}
            >
              <option value="raw">ماده اولیه (خرید از تأمین‌کننده)</option>
              <option value="prepared">آماده پخت (حاصل فرآوری)</option>
            </select>
          </Field>
          <Field
            label="واحد پایه"
            hint={
              row && row.onHand !== 0 ? 'واحد ماده‌ای که موجودی دارد قابل تغییر نیست' : undefined
            }
          >
            <select
              className="pc-input"
              value={unit}
              disabled={Boolean(row && row.onHand !== 0)}
              onChange={(e) => setUnit(e.target.value as Unit)}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`حد هشدار موجودی (${bulkLabel(unit)})`}>
            <NumberInput value={threshold} onChange={setThreshold} />
          </Field>
        </div>
        <Switch
          checked={hasNutrition}
          onChange={setHasNutrition}
          label={`ارزش غذایی در هر ۱۰۰ ${unit === 'pcs' ? '(برای هر عدد)' : UNIT_LABELS[unit]}`}
        />
        {hasNutrition && (
          <div
            className="form-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
          >
            {NUTRIENT_KEYS.map((k) => (
              <Field
                key={k}
                label={`${NUTRIENT_LABELS[k]}${k === 'sodium' ? ' (mg)' : k === 'kcal' ? '' : ' (g)'}`}
              >
                <NumberInput
                  value={nutrition[k]}
                  onChange={(v) => setNutrition((n) => ({ ...n, [k]: v ?? 0 }))}
                />
              </Field>
            ))}
          </div>
        )}
        <Field label="حساسیت‌زاها">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {ALLERGENS.map((a) => (
              <Chip
                key={a}
                pressed={allergens.includes(a)}
                onClick={() =>
                  setAllergens((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]))
                }
              >
                {ALLERGEN_LABELS[a]}
              </Chip>
            ))}
          </div>
        </Field>
        <Switch checked={active} onChange={setActive} label="فعال" />
      </div>
    </Drawer>
  );
}
