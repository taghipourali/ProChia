import { Link } from 'react-router';
import { formatNumber, toFaDigits } from '@prochia/shared';
import { Empty, Money, Skeleton } from '@prochia/ui';
import { DayBars } from '../components/DayBars';
import { useInsights, useMember } from '../lib/queries';

export function InsightsPage() {
  const { isActive, isLoading } = useMember();
  const insights = useInsights(isActive);

  if (isLoading) return null;
  if (!isActive) return <Empty icon="chart" title="گزارش تغذیه برای اعضای فعال است" />;
  if (!insights.data) return <Skeleton height={400} />;
  const d = insights.data;
  const days = d.week.filter((w) => w.orders > 0).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">گزارش تغذیه من</h1>
          <p className="page-sub">آنچه در ۷ روز اخیر از پروچیا خورده‌ای، کنار هدف روزانه‌ات.</p>
        </div>
      </div>

      {!d.targets && (
        <Link to="/welcome" className="notice notice--green">
          برای مقایسه با هدف، پروفایل سلامت را کامل کنید.
        </Link>
      )}

      <div className="stat-grid">
        <div className="stat">
          <span>روزهای سفارش این هفته</span>
          <strong>{toFaDigits(days)} از ۷</strong>
        </div>
        <div className="stat">
          <span>کل پروتئین دریافتی</span>
          <strong>{formatNumber(d.lifetime.protein / 1000, 1)} کیلوگرم</strong>
        </div>
      </div>

      <section className="section stack-l">
        <DayBars
          title="پروتئین روزانه (گرم)"
          unit="گرم"
          color="var(--protein)"
          target={d.targets?.protein ?? null}
          data={d.week.map((w) => ({ date: w.date, value: w.protein }))}
        />
        <DayBars
          title="کالری روزانه"
          unit="کالری"
          color="var(--ink)"
          target={d.targets?.kcal ?? null}
          data={d.week.map((w) => ({ date: w.date, value: w.kcal }))}
        />
      </section>

      {d.favourites.length > 0 && (
        <section className="section">
          <div className="section-title">غذاهای همیشگی‌ات</div>
          <div className="list">
            {d.favourites.map((f) => (
              <div key={f.menuItemId} className="ledger-row">
                <b>{f.name}</b>
                <span className="num page-sub">{toFaDigits(f.count)} بار</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section summary">
        <div>
          <span>کل سفارش‌ها</span>
          <span className="num">{toFaDigits(d.lifetime.orders)}</span>
        </div>
        <div>
          <span>مجموع خرید</span>
          <Money amount={d.lifetime.spent} />
        </div>
      </section>
    </div>
  );
}
