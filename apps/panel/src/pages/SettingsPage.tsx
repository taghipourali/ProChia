import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchSettingsDto, OpeningHours, StaffRole } from '@prochia/shared';
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  WEEKDAYS_FA,
  WEEKDAY_ORDER,
  formatAgo,
} from '@prochia/shared';
import { Button, Field, Tag, useToast } from '@prochia/ui';
import { Drawer, NumberInput, Page, Panel, Switch, Tabs } from '../components/kit';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

interface BranchRow {
  id: string;
  slug: string;
  name: string;
  gymName: string;
  address: string | null;
  phone: string | null;
  instagram: string | null;
  whatsapp: string | null;
  cardNumber: string | null;
  cardHolder: string | null;
  openingHours: OpeningHours;
  settings: BranchSettingsDto;
}
interface Station {
  id: string;
  code: string;
  name: string;
  floorLabel: string | null;
  isAcceptance: boolean;
  defaultPrepMinutes: number;
  sort: number;
  isActive: boolean;
}
interface StaffRow {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  isActive: boolean;
  lastLoginAt: string | null;
  branchId: string | null;
}

type Tab = 'branch' | 'hours' | 'rules' | 'stations' | 'staff' | 'gyms';

export function SettingsPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('branch');
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<{ branch: BranchRow; stations: Station[]; memberUrl: string }>('/staff/settings'),
  });
  const tabs: { value: Tab; label: string }[] = [
    { value: 'branch', label: 'اطلاعات شعبه' },
    { value: 'hours', label: 'ساعت کاری' },
    { value: 'rules', label: 'قوانین سفارش' },
    { value: 'stations', label: 'ایستگاه‌ها' },
    ...(auth.can('staff.manage') ? [{ value: 'staff' as const, label: 'کارکنان' }] : []),
    ...(auth.can('branches.manage') ? [{ value: 'gyms' as const, label: 'باشگاه‌ها' }] : []),
  ];
  const data = settings.data;
  return (
    <Page
      title="تنظیمات"
      subtitle={data ? <span className="ltr">{data.memberUrl}</span> : undefined}
    >
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {data && tab === 'branch' && <BranchForm branch={data.branch} />}
      {data && tab === 'hours' && <HoursForm branch={data.branch} />}
      {data && tab === 'rules' && <RulesForm branch={data.branch} />}
      {data && tab === 'stations' && <Stations stations={data.stations} />}
      {tab === 'staff' && <StaffUsers />}
      {tab === 'gyms' && <Gyms />}
    </Page>
  );
}

function useSaveBranch(branch: BranchRow) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (patch: Partial<BranchRow>) => {
      const b = { ...branch, ...patch };
      return api('/staff/settings', {
        method: 'PUT',
        body: {
          name: b.name,
          gymName: b.gymName,
          address: b.address,
          phone: b.phone,
          instagram: b.instagram,
          whatsapp: b.whatsapp,
          cardNumber: b.cardNumber || null,
          cardHolder: b.cardHolder,
          openingHours: b.openingHours,
          settings: b.settings,
        },
      });
    },
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['settings'] });
      void client.invalidateQueries({ queryKey: ['staff-me'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
}

function BranchForm({ branch }: { branch: BranchRow }) {
  const save = useSaveBranch(branch);
  const [b, setB] = useState(branch);
  const text = (k: keyof BranchRow, label: string, ltr = false) => (
    <Field label={label}>
      <input
        className={ltr ? 'pc-input pc-input--ltr' : 'pc-input'}
        value={(b[k] as string | null) ?? ''}
        onChange={(e) => setB({ ...b, [k]: e.target.value || null })}
      />
    </Field>
  );
  return (
    <Panel>
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div className="form-grid">
          {text('name', 'نام نمایشی')}
          {text('gymName', 'نام باشگاه')}
          {text('phone', 'تلفن', true)}
          {text('instagram', 'اینستاگرام', true)}
          {text('whatsapp', 'واتس‌اپ', true)}
          {text('cardNumber', 'شماره کارت برای کارت‌به‌کارت', true)}
          {text('cardHolder', 'نام صاحب کارت')}
          <div className="wide">{text('address', 'نشانی')}</div>
        </div>
        <div>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(b)}>
            ذخیره
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function HoursForm({ branch }: { branch: BranchRow }) {
  const save = useSaveBranch(branch);
  const [always, setAlways] = useState(Object.keys(branch.openingHours).length === 0);
  const [hours, setHours] = useState<OpeningHours>(() => {
    if (Object.keys(branch.openingHours).length) return branch.openingHours;
    return Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [['07:00', '23:00']]]),
    ) as OpeningHours;
  });
  const key = (d: number) => String(d) as keyof OpeningHours;
  return (
    <Panel>
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <Switch checked={always} onChange={setAlways} label="همیشه باز (۲۴ ساعته)" />
        {!always &&
          WEEKDAY_ORDER.map((d) => {
            const ranges = hours[key(d)] ?? [];
            return (
              <div key={d} className="row" style={{ flexWrap: 'wrap' }}>
                <b style={{ width: 90 }}>{WEEKDAYS_FA[d]}</b>
                {ranges.length === 0 && <Tag>تعطیل</Tag>}
                {ranges.map(([open, close], i) => (
                  <span key={i} className="row" style={{ gap: 6 }}>
                    <input
                      className="pc-input pc-input--ltr"
                      type="time"
                      value={open}
                      style={{ width: 120 }}
                      onChange={(e) =>
                        setHours({
                          ...hours,
                          [key(d)]: ranges.map((r, j) => (j === i ? [e.target.value, r[1]] : r)),
                        })
                      }
                    />
                    تا
                    <input
                      className="pc-input pc-input--ltr"
                      type="time"
                      value={close}
                      style={{ width: 120 }}
                      onChange={(e) =>
                        setHours({
                          ...hours,
                          [key(d)]: ranges.map((r, j) => (j === i ? [r[0], e.target.value] : r)),
                        })
                      }
                    />
                  </span>
                ))}
                <Button
                  size="s"
                  variant="ghost"
                  onClick={() =>
                    setHours({ ...hours, [key(d)]: ranges.length ? [] : [['07:00', '23:00']] })
                  }
                >
                  {ranges.length ? 'تعطیل' : 'باز'}
                </Button>
              </div>
            );
          })}
        <p className="hint">
          بازه‌ای که از نیمه‌شب رد شود (مثلاً ۱۸:۰۰ تا ۰۱:۰۰) هم پشتیبانی می‌شود. خارج از این
          ساعت‌ها فقط پیش‌سفارش ممکن است.
        </p>
        <div>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => save.mutate({ openingHours: always ? {} : hours })}
          >
            ذخیره
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function RulesForm({ branch }: { branch: BranchRow }) {
  const save = useSaveBranch(branch);
  const [s, setS] = useState(branch.settings);
  const promotions = useQuery({
    queryKey: ['promotions'],
    queryFn: () =>
      api<{ promotion: { id: string; title: string; audience: string } }[]>('/staff/promotions'),
  });
  useEffect(() => setS(branch.settings), [branch.settings]);
  const set = <K extends keyof BranchSettingsDto>(k: K, v: BranchSettingsDto[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  return (
    <Panel>
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <Field label="عضویت مشتریان جدید">
          <select
            className="pc-input"
            value={s.memberApproval}
            onChange={(e) =>
              set('memberApproval', e.target.value as BranchSettingsDto['memberApproval'])
            }
          >
            <option value="manual">فهرست باشگاه خودکار، بقیه با تأیید پذیرش</option>
            <option value="whitelist">فقط شماره‌های فهرست باشگاه (بقیه منتظر تأیید)</option>
            <option value="auto">همه خودکار تأیید شوند</option>
          </select>
        </Field>
        <Switch
          checked={s.autoAccept}
          onChange={(v) => set('autoAccept', v)}
          label="تأیید خودکار سفارش وقتی همه مواد در انبار موجود است"
        />
        <Switch
          checked={s.enforceStock}
          onChange={(v) => set('enforceStock', v)}
          label="جلوگیری از سفارش آیتم‌هایی که موادشان در انبار کافی نیست"
        />
        <div className="form-grid">
          <Field label="پیش‌سفارش تا چند روز بعد">
            <NumberInput
              value={s.preorderMaxDays}
              onChange={(v) => set('preorderMaxDays', v ?? 0)}
            />
          </Field>
          <Field label="حداقل فاصله پیش‌سفارش (دقیقه)">
            <NumberInput
              value={s.preorderMinLeadMinutes}
              onChange={(v) => set('preorderMinLeadMinutes', v ?? 20)}
            />
          </Field>
          <Field label="دوره محاسبه سطح باشگاه (روز)">
            <NumberInput
              value={s.tierWindowDays}
              onChange={(v) => set('tierWindowDays', v ?? 90)}
            />
          </Field>
          <Field label="یادآوری وقتی وعده بسته به این عدد رسید">
            <NumberInput
              value={s.lowCreditsThreshold}
              onChange={(v) => set('lowCreditsThreshold', v ?? 2)}
            />
          </Field>
          <Field label="تخفیف هدیه تولد" hint="تخفیف‌های «کد اختصاصی»">
            <select
              className="pc-input"
              value={s.birthdayPromotionId ?? ''}
              onChange={(e) => set('birthdayPromotionId', e.target.value || null)}
            >
              <option value="">غیرفعال</option>
              {promotions.data
                ?.filter((p) => p.promotion.audience === 'personal')
                .map((p) => (
                  <option key={p.promotion.id} value={p.promotion.id}>
                    {p.promotion.title}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => save.mutate({ settings: s })}
          >
            ذخیره
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Stations({ stations }: { stations: Station[] }) {
  const client = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Station> | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api(draft?.id ? `/staff/stations/${draft.id}` : '/staff/stations', {
        method: draft?.id ? 'PUT' : 'POST',
        body: {
          code: draft?.code,
          name: draft?.name,
          floorLabel: draft?.floorLabel ?? null,
          isAcceptance: draft?.isAcceptance ?? false,
          defaultPrepMinutes: draft?.defaultPrepMinutes ?? 10,
          sort: draft?.sort ?? stations.length,
          isActive: draft?.isActive ?? true,
        },
      }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['settings'] });
      setDraft(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Panel
      flush
      title="ایستگاه‌های آماده‌سازی"
      actions={
        <Button icon="plus" onClick={() => setDraft({ isActive: true, defaultPrepMinutes: 10 })}>
          ایستگاه جدید
        </Button>
      }
    >
      <table className="data">
        <thead>
          <tr>
            <th>نام</th>
            <th>طبقه</th>
            <th>نقش</th>
            <th className="n">زمان پیش‌فرض</th>
          </tr>
        </thead>
        <tbody>
          {stations.map((s) => (
            <tr key={s.id} className="clickable" onClick={() => setDraft(s)}>
              <td>
                <b>{s.name}</b> <span className="hint ltr">{s.code}</span>
              </td>
              <td>{s.floorLabel}</td>
              <td>
                {s.isAcceptance ? <Tag tone="ink">تأیید سفارش‌ها</Tag> : <Tag>بعد از تأیید</Tag>}
              </td>
              <td className="n">{s.defaultPrepMinutes} دقیقه</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        ایستگاه «تأیید سفارش‌ها» (رستوران) هر سفارش را اول بررسی می‌کند؛ بقیه ایستگاه‌ها (کافه) فقط
        بعد از تأیید تیکت می‌گیرند.
      </p>
      {draft && (
        <Drawer
          open
          onClose={() => setDraft(null)}
          width={460}
          title={draft.name ?? 'ایستگاه جدید'}
          footer={
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!draft.name || !draft.code}
              onClick={() => save.mutate()}
            >
              ذخیره
            </Button>
          }
        >
          <div className="stack">
            <Field label="نام">
              <input
                className="pc-input"
                value={draft.name ?? ''}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="کد انگلیسی" hint="مثلاً juice-bar">
              <input
                className="pc-input pc-input--ltr"
                value={draft.code ?? ''}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase() })}
              />
            </Field>
            <Field label="طبقه / محل">
              <input
                className="pc-input"
                value={draft.floorLabel ?? ''}
                onChange={(e) => setDraft({ ...draft, floorLabel: e.target.value })}
              />
            </Field>
            <Field label="زمان آماده‌سازی پیش‌فرض (دقیقه)">
              <NumberInput
                value={draft.defaultPrepMinutes ?? null}
                onChange={(v) => setDraft({ ...draft, defaultPrepMinutes: v ?? 10 })}
              />
            </Field>
            <Switch
              checked={draft.isAcceptance ?? false}
              onChange={(v) => setDraft({ ...draft, isAcceptance: v })}
              label="این ایستگاه سفارش‌ها را تأیید می‌کند"
            />
            <Switch
              checked={draft.isActive ?? true}
              onChange={(v) => setDraft({ ...draft, isActive: v })}
              label="فعال"
            />
          </div>
        </Drawer>
      )}
    </Panel>
  );
}

function StaffUsers() {
  const auth = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const users = useQuery({
    queryKey: ['staff-users'],
    queryFn: () => api<StaffRow[]>('/staff/users'),
  });
  const [draft, setDraft] = useState<(Partial<StaffRow> & { password?: string }) | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api(draft?.id ? `/staff/users/${draft.id}` : '/staff/users', {
        method: draft?.id ? 'PUT' : 'POST',
        body: {
          name: draft?.name,
          username: draft?.username,
          role: draft?.role,
          isActive: draft?.isActive ?? true,
          password: draft?.password || undefined,
        },
      }),
    onSuccess: () => {
      toast('ذخیره شد', 'success');
      void client.invalidateQueries({ queryKey: ['staff-users'] });
      setDraft(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const roles = STAFF_ROLES.filter((r) => r !== 'owner' || auth.me?.staff.role === 'owner');
  return (
    <Panel
      flush
      title="کارکنان"
      actions={
        <Button icon="plus" onClick={() => setDraft({ role: 'restaurant', isActive: true })}>
          کاربر جدید
        </Button>
      }
    >
      <table className="data">
        <thead>
          <tr>
            <th>نام</th>
            <th>نام کاربری</th>
            <th>نقش</th>
            <th>آخرین ورود</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => (
            <tr
              key={u.id}
              className="clickable"
              onClick={() => setDraft(u)}
              style={u.isActive ? undefined : { opacity: 0.5 }}
            >
              <td>
                <b>{u.name}</b>
              </td>
              <td className="ltr">{u.username}</td>
              <td>{STAFF_ROLE_LABELS[u.role]}</td>
              <td className="hint">{u.lastLoginAt ? formatAgo(new Date(u.lastLoginAt)) : '—'}</td>
              <td>{!u.isActive && <Tag>غیرفعال</Tag>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft && (
        <Drawer
          open
          onClose={() => setDraft(null)}
          width={460}
          title={draft.name ?? 'کاربر جدید'}
          footer={
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!draft.name || !draft.username || (!draft.id && !draft.password)}
              onClick={() => save.mutate()}
            >
              ذخیره
            </Button>
          }
        >
          <div className="stack">
            <Field label="نام">
              <input
                className="pc-input"
                value={draft.name ?? ''}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="نام کاربری">
              <input
                className="pc-input pc-input--ltr"
                value={draft.username ?? ''}
                onChange={(e) => setDraft({ ...draft, username: e.target.value.toLowerCase() })}
              />
            </Field>
            <Field label="نقش">
              <select
                className="pc-input"
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as StaffRole })}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {STAFF_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={draft.id ? 'رمز عبور جدید (خالی = بدون تغییر)' : 'رمز عبور'}
              hint="حداقل ۸ کاراکتر"
            >
              <input
                className="pc-input pc-input--ltr"
                type="password"
                value={draft.password ?? ''}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </Field>
            <Switch
              checked={draft.isActive ?? true}
              onChange={(v) => setDraft({ ...draft, isActive: v })}
              label="فعال"
            />
          </div>
        </Drawer>
      )}
    </Panel>
  );
}

function Gyms() {
  const client = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['branches'],
    queryFn: () =>
      api<{ id: string; slug: string; name: string; gymName: string; isActive: boolean }[]>(
        '/staff/branches',
      ),
  });
  const [slug, setSlug] = useState('');
  const [gymName, setGymName] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<{ memberUrl: string }>('/staff/branches', {
        method: 'POST',
        body: { slug, name: 'پروچیا', gymName },
      }),
    onSuccess: (r) => {
      toast(`ساخته شد: ${r.memberUrl}`, 'success');
      setSlug('');
      setGymName('');
      void client.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="grid-2">
      <Panel title="باشگاه‌ها" flush>
        <table className="data">
          <tbody>
            {list.data?.map((b) => (
              <tr key={b.id}>
                <td>
                  <b>{b.gymName}</b>
                </td>
                <td className="ltr hint">{b.slug}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="باشگاه جدید">
        <div className="stack">
          <Field label="نام باشگاه">
            <input
              className="pc-input"
              value={gymName}
              onChange={(e) => setGymName(e.target.value)}
            />
          </Field>
          <Field label="زیردامنه" hint="مثلاً arena ← arena.prochia.ir">
            <input
              className="pc-input pc-input--ltr"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </Field>
          <Button
            variant="primary"
            disabled={!slug || !gymName}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            ساخت
          </Button>
          <p className="hint">
            رستوران و کافه به‌صورت پیش‌فرض ساخته می‌شوند؛ بعد از ساخت از منوی کناری شعبه را عوض کنید
            و منو و انبار را تعریف کنید.
          </p>
        </div>
      </Panel>
    </div>
  );
}
