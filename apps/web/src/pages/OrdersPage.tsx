import { Link } from 'react-router';
import { ORDER_STATUS_LABELS, formatDateTime, toFaDigits } from '@prochia/shared';
import { Empty, Icon, Money, Skeleton, Tag } from '@prochia/ui';
import { orderStatusTone } from '../components/OrderStatus';
import { useMember, useOrders } from '../lib/queries';

export function OrdersPage() {
  const { user, isActive, isLoading } = useMember();
  const orders = useOrders(isActive);

  if (!isLoading && !user) {
    return (
      <Empty icon="receipt" title="سفارش‌های شما اینجا می‌آید">
        <Link to="/login?next=/orders" className="pc-btn pc-btn--s" style={{ marginTop: 8 }}>
          ورود
        </Link>
      </Empty>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">سفارش‌ها</h1>
      </div>
      {orders.isLoading && <Skeleton height={240} />}
      {orders.data?.length === 0 && <Empty icon="bowl" title="هنوز سفارشی ثبت نکرده‌اید" />}
      <div className="list">
        {orders.data?.map((o) => (
          <Link
            key={o.id}
            to={`/orders/${o.id}`}
            className="link-row"
            style={{ alignItems: 'flex-start', padding: 'var(--space-3) 0' }}
          >
            <span
              className="num"
              style={{ fontSize: 'var(--text-xl)', fontWeight: 900, minWidth: 44 }}
            >
              {toFaDigits(o.number)}
            </span>
            <span style={{ flex: 1 }}>
              <span className="row" style={{ gap: 6 }}>
                <Tag tone={orderStatusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Tag>
                {o.scheduledFor && <Tag tone="info">پیش‌سفارش</Tag>}
              </span>
              <small>{o.lines.map((l) => l.name).join('، ')}</small>
              <small className="num">{formatDateTime(new Date(o.createdAt))}</small>
            </span>
            <Money amount={o.total} />
            <Icon name="chevronLeft" />
          </Link>
        ))}
      </div>
    </div>
  );
}
