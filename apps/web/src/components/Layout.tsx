import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { toFaDigits } from '@prochia/shared';
import { Icon, Money, Wordmark, type IconName } from '@prochia/ui';
import { useCart } from '../lib/cart';
import { useBranch, useMember } from '../lib/queries';
import { useCartTotal, useItemIndex } from './useCartTotal';

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'منو', icon: 'menu', end: true },
  { to: '/orders', label: 'سفارش‌ها', icon: 'receipt' },
  { to: '/plans', label: 'بسته‌ها', icon: 'box' },
  { to: '/account', label: 'حساب من', icon: 'user' },
];

export function Layout() {
  const branch = useBranch();
  const { user } = useMember();
  const cart = useCart();
  const total = useCartTotal();
  const items = useItemIndex();
  const location = useLocation();

  // Drop cart lines for items that have left the menu since they were added.
  useEffect(() => {
    if (!items.size) return;
    for (const line of cart.lines) if (!items.has(line.itemId)) cart.setQuantity(line.key, 0);
  }, [items, cart]);
  const navigate = useNavigate();
  const showCartBar = cart.count > 0 && location.pathname !== '/cart';

  return (
    <div className="app">
      <header className="app-header">
        <NavLink to="/" className="app-header__brand" aria-label="پروچیا — منو">
          <Wordmark subtitle={branch.data?.gymName ?? ' '} />
        </NavLink>
        <div className="app-header__actions">
          {branch.data && !branch.data.isOpen && (
            <span className="pc-tag pc-tag--warning">فعلاً بسته — پیش‌سفارش باز است</span>
          )}
          <button
            type="button"
            className="pc-btn pc-btn--ghost pc-btn--icon"
            onClick={() => navigate(user ? '/account' : '/login')}
            aria-label={user ? 'حساب من' : 'ورود'}
          >
            <Icon name="user" />
          </button>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      {showCartBar && (
        <button type="button" className="cart-bar" onClick={() => navigate('/cart')}>
          <span className="cart-bar__count num">{toFaDigits(cart.count)}</span>
          <span>مشاهده سبد و ثبت سفارش</span>
          <span className="cart-bar__total">{total !== null && <Money amount={total} />}</span>
        </button>
      )}

      <nav className="bottom-nav" aria-label="بخش‌های اصلی">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="bottom-nav__item">
            <Icon name={tab.icon} size={22} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
