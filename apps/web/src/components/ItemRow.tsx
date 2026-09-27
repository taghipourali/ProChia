import type { Allergen, MenuItemDto } from '@prochia/shared';
import { ALLERGEN_LABELS, ITEM_TAG_LABELS, toFaDigits } from '@prochia/shared';
import { Icon, MacroLine, Money, Tag } from '@prochia/ui';
import { useCart } from '../lib/cart';
import { FoodThumb } from './FoodThumb';
import { Stepper } from './Stepper';

const SHOWN_TAGS = [
  'high_protein',
  'low_carb',
  'vegan',
  'pre_workout',
  'post_workout',
  'keto',
] as const;

export function ItemRow({
  item,
  isCafe,
  onOpen,
  memberAllergens,
}: {
  item: MenuItemDto;
  isCafe: boolean;
  onOpen: () => void;
  memberAllergens: Allergen[];
}) {
  const cart = useCart();
  const simple = item.groups.every((g) => g.minSelect === 0);
  const baseLine = cart.lines.find(
    (l) => l.itemId === item.id && l.optionIds.length === 0 && !l.note,
  );
  const conflicts = item.allergens.filter((a) => memberAllergens.includes(a));
  const tags = item.tags
    .filter((t): t is (typeof SHOWN_TAGS)[number] => (SHOWN_TAGS as readonly string[]).includes(t))
    .slice(0, 2);

  return (
    <article
      className="item-row"
      aria-disabled={!item.available}
      onClick={item.available ? onOpen : undefined}
      role={item.available ? 'button' : undefined}
      tabIndex={item.available ? 0 : undefined}
      onKeyDown={(e) =>
        item.available && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())
      }
      aria-label={item.name}
    >
      <FoodThumb item={item} isCafe={isCafe} />
      <div className="item-row__body">
        <div className="item-row__top">
          <h3 className="item-row__name">{item.name}</h3>
          <Money amount={item.price} className="item-row__price" />
        </div>
        {item.description && <p className="item-row__desc">{item.description}</p>}
        <MacroLine nutrition={item.nutrition} />
        <div className="item-row__foot">
          <div className="item-row__tags">
            {!item.available ? (
              <Tag tone="danger">تمام شد</Tag>
            ) : (
              <>
                {conflicts.length > 0 && (
                  <Tag tone="warning">
                    حاوی {conflicts.map((a) => ALLERGEN_LABELS[a]).join('، ')}
                  </Tag>
                )}
                {item.portionsLeft !== null && (
                  <Tag tone="warning">فقط {toFaDigits(item.portionsLeft)} عدد</Tag>
                )}
                {tags.map((t) => (
                  <Tag key={t} tone={t === 'high_protein' ? 'green' : undefined}>
                    {ITEM_TAG_LABELS[t]}
                  </Tag>
                ))}
              </>
            )}
          </div>
          {item.available &&
            (simple && baseLine ? (
              <Stepper
                value={baseLine.quantity}
                onChange={(q) => cart.setQuantity(baseLine.key, q)}
              />
            ) : (
              <button
                type="button"
                className="add-btn"
                aria-label={`افزودن ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (simple) cart.add(item, []);
                  else onOpen();
                }}
              >
                <Icon name="plus" size={18} />
              </button>
            ))}
        </div>
      </div>
    </article>
  );
}
