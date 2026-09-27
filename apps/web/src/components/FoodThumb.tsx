import type { MenuItemDto } from '@prochia/shared';
import { formatNumber } from '@prochia/shared';

/**
 * Until real photos exist, the thumbnail shows the item's headline number: protein for meals,
 * calories for drinks and light snacks. It doubles as information, not decoration.
 */
export function FoodThumb({
  item,
  large,
  isCafe,
}: {
  item: MenuItemDto;
  large?: boolean;
  isCafe?: boolean;
}) {
  const cls = ['thumb', large && 'thumb--large', isCafe && 'thumb--cafe'].filter(Boolean).join(' ');
  if (item.imageUrl) {
    return (
      <div className={cls}>
        <img src={item.imageUrl} alt="" loading="lazy" />
      </div>
    );
  }
  const showProtein = item.nutrition.protein >= 10;
  return (
    <div className={cls} aria-hidden="true">
      <span className="thumb__num">
        {formatNumber(Math.round(showProtein ? item.nutrition.protein : item.nutrition.kcal))}
      </span>
      <span className="thumb__unit">{showProtein ? 'گرم پروتئین' : 'کالری'}</span>
    </div>
  );
}
