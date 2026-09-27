import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { GOAL_LABELS, maskMobile, toFaDigits } from '@prochia/shared';
import { Button, Empty, Icon, Money, Tag, type IconName } from '@prochia/ui';
import { api } from '../lib/api';
import { useBranch, useMember, useSubscriptions } from '../lib/queries';

export function AccountPage() {
  const { user, membership, health, isActive, isLoading } = useMember();
  const branch = useBranch();
  const subs = useSubscriptions(isActive);
  const client = useQueryClient();
  const navigate = useNavigate();

  if (isLoading) return null;
  if (!user) {
    return (
      <Empty icon="user" title="وارد حساب خود شوید">
        <p>برای سفارش، کیف پول، بسته‌ها و باشگاه مشتریان.</p>
        <Link
          to="/login?next=/account"
          className="pc-btn pc-btn--primary"
          style={{ marginTop: 12 }}
        >
          ورود با شماره موبایل
        </Link>
      </Empty>
    );
  }

  const credits = (subs.data ?? [])
    .filter((s) => s.status === 'active')
    .reduce((sum, s) => sum + s.remaining, 0);
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    client.clear();
    navigate('/');
  };

  const links: { to: string; icon: IconName; title: string; hint: string }[] = [
    {
      to: '/account/health',
      icon: 'scale',
      title: 'پروفایل سلامت و اهداف',
      hint: health ? `هدف: ${GOAL_LABELS[health.goal]}` : 'هنوز کامل نشده',
    },
    {
      to: '/account/insights',
      icon: 'chart',
      title: 'گزارش تغذیه من',
      hint: 'کالری و پروتئین هفته',
    },
    { to: '/wallet', icon: 'wallet', title: 'کیف پول', hint: 'شارژ با هدیه' },
    {
      to: '/plans',
      icon: 'box',
      title: 'بسته‌ها و برنامه‌های غذایی',
      hint: credits ? `${toFaDigits(credits)} وعده باقی‌مانده` : 'خرید بسته با تخفیف',
    },
    {
      to: '/club',
      icon: 'gift',
      title: 'باشگاه مشتریان',
      hint: membership?.tier ? `سطح ${membership.tier.name}` : 'سطح‌ها و کدهای تخفیف',
    },
    { to: '/orders', icon: 'receipt', title: 'سفارش‌ها', hint: 'پیگیری و سابقه' },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {[user.firstName, user.lastName].filter(Boolean).join(' ') || 'حساب من'}
          </h1>
          <p className="page-sub ltr num">{maskMobile(user.phone)}</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {membership?.isVip && <Tag tone="ink">VIP</Tag>}
          {membership?.tier && <Tag tone="lime">{membership.tier.name}</Tag>}
        </div>
      </div>

      {membership?.status === 'pending' && (
        <div className="notice notice--warning">
          <Icon name="clock" />
          عضویت شما در {branch.data?.gymName} در انتظار تأیید پذیرش است.
        </div>
      )}
      {!health && (
        <Link
          to="/welcome"
          className="notice notice--green"
          style={{ marginTop: 'var(--space-3)' }}
        >
          <Icon name="scale" />
          پروفایل سلامت را کامل کنید تا منو بر اساس بدن و هدف شما شخصی شود.
        </Link>
      )}

      {isActive && membership && (
        <div className="stat-grid" style={{ marginTop: 'var(--space-3)' }}>
          <Link to="/wallet" className="stat" style={{ color: 'inherit' }}>
            <span>موجودی کیف پول</span>
            <strong>
              <Money amount={membership.walletBalance} />
            </strong>
          </Link>
          <Link to="/plans" className="stat" style={{ color: 'inherit' }}>
            <span>وعده‌های بسته</span>
            <strong className="num">{toFaDigits(credits)}</strong>
          </Link>
          {membership.isVip && (
            <Link to="/wallet" className="stat" style={{ color: 'inherit', gridColumn: '1 / -1' }}>
              <span>حساب اعتباری VIP</span>
              <strong>
                <Money amount={membership.postpaidOwed} />{' '}
                <small className="muted">
                  از سقف {toFaDigits(Math.round(membership.creditLimit / 1_000_000))} میلیون
                </small>
              </strong>
            </Link>
          )}
        </div>
      )}

      <section className="section list" style={{ borderTop: 0 }}>
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="link-row">
            <Icon name={l.icon} />
            <span>
              {l.title}
              <small>{l.hint}</small>
            </span>
            <Icon name="chevronLeft" />
          </Link>
        ))}
      </section>

      {branch.data && (
        <section className="section stack">
          <div className="section-title">پروچیا {branch.data.gymName}</div>
          {branch.data.address && <p className="muted">{branch.data.address}</p>}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {branch.data.instagram && (
              <a
                className="pc-btn pc-btn--s"
                href={`https://instagram.com/${branch.data.instagram}`}
                target="_blank"
                rel="noreferrer"
              >
                اینستاگرام
              </a>
            )}
            {branch.data.whatsapp && (
              <a
                className="pc-btn pc-btn--s"
                href={`https://wa.me/98${branch.data.whatsapp.replace(/^0/, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                واتس‌اپ
              </a>
            )}
            {branch.data.phone && (
              <a className="pc-btn pc-btn--s" href={`tel:${branch.data.phone}`}>
                تماس
              </a>
            )}
          </div>
        </section>
      )}

      <section className="section">
        <Button variant="ghost" icon="logout" onClick={() => void logout()}>
          خروج از حساب
        </Button>
      </section>
    </div>
  );
}
