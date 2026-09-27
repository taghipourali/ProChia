import { Link } from 'react-router';
import type { MenuItemDto } from '@prochia/shared';
import { GOAL_LABELS, MEAL_SLOT_LABELS, formatNumber } from '@prochia/shared';
import { Icon, MacroLine, Money, Progress, Skeleton } from '@prochia/ui';
import { useMember, useRecommendations } from '../lib/queries';
import { track } from '../lib/track';

/**
 * The personal layer on top of the menu: what fits this member's goal right now, and how much of
 * today's protein and energy they have already covered through ProChia.
 */
export function Suggestions({ onOpen }: { onOpen: (item: MenuItemDto) => void }) {
  const { user, isActive, health, isLoading } = useMember();
  const recs = useRecommendations(Boolean(isActive && health));

  if (isLoading) return null;

  if (!user) {
    return (
      <div className="suggest">
        <div className="suggest__head">
          <div>
            <div className="suggest__title">منوی مخصوص بدن تو</div>
            <p className="page-sub">
              با شماره موبایلت وارد شو، قد و وزن و هدفت را بگو؛ غذای مناسب هر وعده را پیشنهاد
              می‌دهیم.
            </p>
          </div>
        </div>
        <Link to="/login" className="pc-btn pc-btn--ink pc-btn--s">
          ورود با شماره موبایل
        </Link>
      </div>
    );
  }

  if (!health) {
    return (
      <Link to="/welcome" className="suggest row" style={{ color: 'inherit' }}>
        <Icon name="scale" size={28} />
        <div style={{ flex: 1 }}>
          <div className="suggest__title" style={{ fontSize: 'var(--text-m)' }}>
            پروفایل سلامتت را کامل کن
          </div>
          <p className="page-sub">
            دو دقیقه طول می‌کشد؛ بعدش کالری و پروتئین هر غذا را نسبت به نیاز خودت می‌بینی.
          </p>
        </div>
        <Icon name="chevronLeft" />
      </Link>
    );
  }

  if (!isActive) return null;
  if (recs.isLoading || !recs.data) {
    return (
      <div className="suggest stack">
        <Skeleton height={22} width="60%" />
        <Skeleton height={120} />
      </div>
    );
  }
  if (recs.data.needsProfile || recs.data.items.length === 0) return null;

  const { slot, daily, eatenToday, items } = recs.data;
  return (
    <section className="suggest" aria-labelledby="suggest-title">
      <div className="suggest__head">
        <div>
          <h2 id="suggest-title" className="suggest__title">
            پیشنهاد برای {MEAL_SLOT_LABELS[slot]}
          </h2>
          <p className="page-sub">بر اساس هدف {GOAL_LABELS[health.goal]} و آنچه امروز خورده‌ای</p>
        </div>
        <Link to="/account/insights" className="pc-btn pc-btn--s">
          گزارش من
        </Link>
      </div>

      <div className="today">
        <div className="today__line">
          <span>پروتئین امروز</span>
          <span className="num">
            <b>{formatNumber(eatenToday.protein)}</b> از {formatNumber(daily.protein)} گرم
          </span>
        </div>
        <Progress value={eatenToday.protein} max={daily.protein} color="var(--protein)" />
        <div className="today__line">
          <span>کالری امروز</span>
          <span className="num">
            <b>{formatNumber(eatenToday.kcal)}</b> از {formatNumber(daily.kcal)}
          </span>
        </div>
        <Progress value={eatenToday.kcal} max={daily.kcal} color="var(--ink)" />
      </div>

      <div className="scroll-x">
        {items.map((s) => (
          <button
            key={s.itemId}
            type="button"
            className="suggest-card"
            onClick={() => {
              track('suggestion_click', { item: s.itemId, slot });
              onOpen(s.item);
            }}
          >
            <span className="suggest-card__name">{s.item.name}</span>
            <MacroLine nutrition={s.item.nutrition} />
            {s.reasons.slice(0, 2).map((r) => (
              <span key={r} className="suggest-card__reason">
                {r}
              </span>
            ))}
            <Money amount={s.item.price} className="item-row__price" />
          </button>
        ))}
      </div>
    </section>
  );
}
