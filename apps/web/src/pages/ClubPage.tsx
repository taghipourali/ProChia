import { Link } from 'react-router';
import { formatDateTime, formatNumber, formatToman, toFaDigits } from '@prochia/shared';
import { Button, Empty, Icon, Money, Progress, Skeleton, Tag, useToast } from '@prochia/ui';
import { useClub, useMember } from '../lib/queries';

const discountText = (kind: 'percent' | 'amount', value: number) =>
  kind === 'percent' ? `${toFaDigits(value)}٪ تخفیف` : `${formatToman(value)} تخفیف`;

export function ClubPage() {
  const { isActive, isLoading } = useMember();
  const club = useClub(isActive);
  const toast = useToast();

  if (isLoading) return null;
  if (!isActive) return <Empty icon="gift" title="باشگاه مشتریان برای اعضای فعال است" />;
  if (!club.data) return <Skeleton height={300} />;
  const c = club.data;

  const copy = (code: string) =>
    void navigator.clipboard?.writeText(code).then(() => toast('کد کپی شد'));

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">باشگاه مشتریان</h1>
      </div>

      <div className="tier-card">
        <span className="muted">سطح فعلی</span>
        <div className="row-between">
          <strong style={{ fontSize: 'var(--text-2xl)', fontWeight: 900 }}>
            {c.tier?.name ?? 'عضو'}
          </strong>
          {c.discountPct > 0 && <Tag tone="lime">{toFaDigits(c.discountPct)}٪ تخفیف همیشگی</Tag>}
        </div>
        {c.next ? (
          <>
            <Progress
              value={c.spend - (c.tier?.minSpend ?? 0)}
              max={c.next.minSpend - (c.tier?.minSpend ?? 0)}
              color="var(--lime)"
            />
            <span className="muted">
              {formatToman(c.toNext)} خرید دیگر تا سطح{' '}
              <b style={{ color: '#fff' }}>{c.next.name}</b> ({toFaDigits(c.next.discountPct)}٪
              تخفیف)
            </span>
          </>
        ) : (
          <span className="muted">بالاترین سطح باشگاه. ممنون که همراه ما هستی!</span>
        )}
        <span className="muted num">
          خرید {toFaDigits(c.windowDays)} روز اخیر: <Money amount={c.spend} />
        </span>
      </div>

      <section className="section">
        <div className="section-title">سطح‌ها</div>
        <div className="list">
          {c.tiers.map((t) => (
            <div key={t.id} className="ledger-row">
              <div>
                <b>{t.name}</b> {c.tier?.id === t.id && <Tag tone="green">شما</Tag>}
                {t.perks && <div className="page-sub">{t.perks}</div>}
              </div>
              <span className="num page-sub">
                {t.minSpend ? `از ${formatNumber(t.minSpend / 1_000_000)} میلیون` : 'از ابتدا'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section stack">
        <div className="section-title">کدهای تخفیف من</div>
        {c.offers.personalCodes.length + c.offers.publicCodes.length + c.offers.automatic.length ===
          0 && <p className="muted">فعلاً کد فعالی ندارید. روز تولدتان منتظر هدیه باشید!</p>}
        {c.offers.personalCodes.map((o) => (
          <div key={o.code} className="code-box">
            <div>
              <b>{o.title}</b>
              <div className="page-sub num">
                {discountText(o.kind, o.value)} · تا {formatDateTime(new Date(o.expiresAt))}
              </div>
            </div>
            <Button size="s" icon="copy" onClick={() => copy(o.code)}>
              <code className="ltr">{o.code}</code>
            </Button>
          </div>
        ))}
        {c.offers.publicCodes.map((o) => (
          <div key={o.code} className="code-box">
            <div>
              <b>{o.title}</b>
              <div className="page-sub">
                {o.description ?? discountText(o.kind, o.value)}
                {o.minOrder > 0 && ` · حداقل سفارش ${formatToman(o.minOrder)}`}
              </div>
            </div>
            <Button size="s" icon="copy" onClick={() => copy(o.code)}>
              <code className="ltr">{o.code}</code>
            </Button>
          </div>
        ))}
        {c.offers.automatic.map((o) => (
          <div key={o.id} className="notice notice--green">
            <Icon name="sparkle" />
            <div>
              <b>{o.title}</b> — بدون کد، خودکار روی سفارش بعدی اعمال می‌شود.
            </div>
          </div>
        ))}
      </section>

      <Link to="/wallet" className="notice" style={{ color: 'inherit' }}>
        <Icon name="wallet" />
        شارژ کیف پول هم هدیه دارد؛ هرچه شارژ بیشتر، هدیه بیشتر.
      </Link>
    </div>
  );
}
