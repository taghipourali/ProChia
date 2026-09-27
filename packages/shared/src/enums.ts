/**
 * Domain vocabularies shared by the API, the member app and the staff panel.
 * Each list is the single source of truth for the database enum and its Persian label.
 */

type Labels<T extends readonly string[]> = Record<T[number], string>;

export const GOALS = ['cut', 'recomp', 'maintain', 'bulk'] as const;
export type Goal = (typeof GOALS)[number];
export const GOAL_LABELS: Labels<typeof GOALS> = {
  cut: 'کات (چربی‌سوزی)',
  recomp: 'ریکامپ',
  maintain: 'حفظ وزن',
  bulk: 'حجم',
};

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'high', 'athlete'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];
export const ACTIVITY_LABELS: Labels<typeof ACTIVITY_LEVELS> = {
  sedentary: 'کم‌تحرک (بدون تمرین)',
  light: 'سبک — ۱ تا ۲ جلسه در هفته',
  moderate: 'متوسط — ۳ تا ۴ جلسه در هفته',
  high: 'زیاد — ۵ تا ۶ جلسه در هفته',
  athlete: 'ورزشکار حرفه‌ای — روزانه و سنگین',
};

export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];
export const SEX_LABELS: Labels<typeof SEXES> = { male: 'مرد', female: 'زن' };

export const TRAINING_TIMES = ['morning', 'noon', 'afternoon', 'evening', 'night'] as const;
export type TrainingTime = (typeof TRAINING_TIMES)[number];
export const TRAINING_TIME_LABELS: Labels<typeof TRAINING_TIMES> = {
  morning: 'صبح',
  noon: 'ظهر',
  afternoon: 'عصر',
  evening: 'غروب',
  night: 'شب',
};

export const ALLERGENS = [
  'gluten',
  'dairy',
  'lactose',
  'egg',
  'nuts',
  'peanut',
  'soy',
  'fish',
  'shellfish',
  'sesame',
] as const;
export type Allergen = (typeof ALLERGENS)[number];
export const ALLERGEN_LABELS: Labels<typeof ALLERGENS> = {
  gluten: 'گلوتن',
  dairy: 'لبنیات',
  lactose: 'لاکتوز',
  egg: 'تخم‌مرغ',
  nuts: 'مغزها',
  peanut: 'بادام‌زمینی',
  soy: 'سویا',
  fish: 'ماهی',
  shellfish: 'میگو و صدف',
  sesame: 'کنجد',
};

export const ITEM_TAGS = [
  'high_protein',
  'low_carb',
  'low_fat',
  'keto',
  'vegan',
  'vegetarian',
  'gluten_free',
  'pre_workout',
  'post_workout',
  'spicy',
  'caffeine',
] as const;
export type ItemTag = (typeof ITEM_TAGS)[number];
export const ITEM_TAG_LABELS: Labels<typeof ITEM_TAGS> = {
  high_protein: 'پرپروتئین',
  low_carb: 'کم‌کربو',
  low_fat: 'کم‌چرب',
  keto: 'کتو',
  vegan: 'وگان',
  vegetarian: 'گیاهی',
  gluten_free: 'بدون گلوتن',
  pre_workout: 'قبل تمرین',
  post_workout: 'بعد تمرین',
  spicy: 'تند',
  caffeine: 'کافئین‌دار',
};

/** Tags a member can avoid entirely (diet preferences), as opposed to allergens. */
export const DIET_PREFERENCES = ['vegan', 'vegetarian', 'gluten_free', 'no_caffeine'] as const;
export type DietPreference = (typeof DIET_PREFERENCES)[number];
export const DIET_PREFERENCE_LABELS: Labels<typeof DIET_PREFERENCES> = {
  vegan: 'وگان',
  vegetarian: 'گیاه‌خوار',
  gluten_free: 'بدون گلوتن',
  no_caffeine: 'بدون کافئین',
};

export const ORDER_TYPES = ['dine_in', 'pickup'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const ORDER_TYPE_LABELS: Labels<typeof ORDER_TYPES> = {
  dine_in: 'سر میز',
  pickup: 'تحویل حضوری',
};

/**
 * Order lifecycle. `placed` orders wait for the acceptance station (the restaurant) to confirm
 * that everything can be made; only then do the other stations (the café) receive their tickets.
 */
export const ORDER_STATUSES = [
  'awaiting_payment',
  'placed',
  'accepted',
  'preparing',
  'ready',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Labels<typeof ORDER_STATUSES> = {
  awaiting_payment: 'در انتظار پرداخت',
  placed: 'در انتظار تأیید',
  accepted: 'تأیید شد',
  preparing: 'در حال آماده‌سازی',
  ready: 'آماده تحویل',
  completed: 'تحویل شد',
  rejected: 'رد شد',
  cancelled: 'لغو شد',
};
export const OPEN_ORDER_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'ready',
] as const satisfies readonly OrderStatus[];

/**
 * `held`: waiting for order acceptance. `scheduled`: accepted pre-order, released to the
 * station when its due time arrives. `queued` → `preparing` → `ready` → `served`.
 */
export const TICKET_STATUSES = [
  'held',
  'scheduled',
  'queued',
  'preparing',
  'ready',
  'served',
  'cancelled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Labels<typeof TICKET_STATUSES> = {
  held: 'منتظر تأیید رستوران',
  scheduled: 'پیش‌سفارش زمان‌بندی‌شده',
  queued: 'در صف',
  preparing: 'در حال آماده‌سازی',
  ready: 'آماده',
  served: 'تحویل شد',
  cancelled: 'لغو شد',
};

export const PAYMENT_METHODS = [
  'gateway',
  'wallet',
  'card_to_card',
  'counter',
  'postpaid',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Labels<typeof PAYMENT_METHODS> = {
  gateway: 'پرداخت آنلاین',
  wallet: 'کیف پول',
  card_to_card: 'کارت‌به‌کارت',
  counter: 'پرداخت در صندوق',
  postpaid: 'پرداخت بعدی (اعتباری)',
};

export const PAYMENT_STATUSES = [
  'pending',
  'awaiting_review',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Labels<typeof PAYMENT_STATUSES> = {
  pending: 'در انتظار',
  awaiting_review: 'در انتظار بررسی',
  succeeded: 'موفق',
  failed: 'ناموفق',
  cancelled: 'لغو شده',
};

export const PAYMENT_PURPOSES = [
  'order',
  'wallet_topup',
  'plan_purchase',
  'postpaid_settlement',
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];
export const PAYMENT_PURPOSE_LABELS: Labels<typeof PAYMENT_PURPOSES> = {
  order: 'سفارش',
  wallet_topup: 'شارژ کیف پول',
  plan_purchase: 'خرید بسته',
  postpaid_settlement: 'تسویه حساب اعتباری',
};

export const ORDER_PAYMENT_STATES = ['unpaid', 'paid', 'postpaid', 'refunded'] as const;
export type OrderPaymentState = (typeof ORDER_PAYMENT_STATES)[number];

export const WALLET_ENTRY_KINDS = [
  'topup',
  'bonus',
  'order',
  'refund',
  'plan_purchase',
  'postpaid_settlement',
  'adjustment',
] as const;
export type WalletEntryKind = (typeof WALLET_ENTRY_KINDS)[number];
export const WALLET_ENTRY_LABELS: Labels<typeof WALLET_ENTRY_KINDS> = {
  topup: 'شارژ',
  bonus: 'پاداش شارژ',
  order: 'سفارش',
  refund: 'بازگشت وجه',
  plan_purchase: 'خرید بسته',
  postpaid_settlement: 'تسویه اعتباری',
  adjustment: 'اصلاح توسط مدیر',
};

export const STAFF_ROLES = [
  'owner',
  'manager',
  'restaurant',
  'cafe',
  'storage',
  'cashier',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_ROLE_LABELS: Labels<typeof STAFF_ROLES> = {
  owner: 'مالک',
  manager: 'مدیر شعبه',
  restaurant: 'رستوران',
  cafe: 'کافه',
  storage: 'انباردار',
  cashier: 'صندوق‌دار',
};

export const UNITS = ['g', 'ml', 'pcs'] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_LABELS: Labels<typeof UNITS> = { g: 'گرم', ml: 'میلی‌لیتر', pcs: 'عدد' };
/** Larger unit used for display and data entry (کیلوگرم، لیتر). */
export const UNIT_BULK: Record<Unit, { label: string; factor: number }> = {
  g: { label: 'کیلوگرم', factor: 1000 },
  ml: { label: 'لیتر', factor: 1000 },
  pcs: { label: 'عدد', factor: 1 },
};

export const INGREDIENT_KINDS = ['raw', 'prepared'] as const;
export type IngredientKind = (typeof INGREDIENT_KINDS)[number];
export const INGREDIENT_KIND_LABELS: Labels<typeof INGREDIENT_KINDS> = {
  raw: 'ماده اولیه',
  prepared: 'آماده پخت',
};

export const STOCK_REASONS = [
  'purchase',
  'production_in',
  'production_out',
  'sale',
  'sale_reversal',
  'waste',
  'adjustment',
] as const;
export type StockReason = (typeof STOCK_REASONS)[number];
export const STOCK_REASON_LABELS: Labels<typeof STOCK_REASONS> = {
  purchase: 'خرید / ورود به انبار',
  production_in: 'تولید (خروجی فرآوری)',
  production_out: 'مصرف در فرآوری',
  sale: 'مصرف در سفارش',
  sale_reversal: 'برگشت سفارش',
  waste: 'ضایعات',
  adjustment: 'اصلاح موجودی',
};

export const PLAN_KINDS = ['package', 'meal_plan'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const PLAN_KIND_LABELS: Labels<typeof PLAN_KINDS> = {
  package: 'بسته وعده',
  meal_plan: 'برنامه غذایی',
};

export const SUBSCRIPTION_STATUSES = ['pending_payment', 'active', 'expired', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['pending', 'active', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export const MEMBERSHIP_STATUS_LABELS: Labels<typeof MEMBERSHIP_STATUSES> = {
  pending: 'در انتظار تأیید',
  active: 'فعال',
  suspended: 'مسدود',
};

export const PROMOTION_KINDS = ['percent', 'amount'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const PROMOTION_AUDIENCES = ['all', 'tier', 'goal', 'first_order', 'personal'] as const;
export type PromotionAudience = (typeof PROMOTION_AUDIENCES)[number];
export const PROMOTION_AUDIENCE_LABELS: Labels<typeof PROMOTION_AUDIENCES> = {
  all: 'همه اعضا',
  tier: 'سطح باشگاه مشتریان',
  goal: 'هدف تمرینی',
  first_order: 'اولین سفارش',
  personal: 'کد اختصاصی (مثل تولد)',
};

export const SMS_TEMPLATES = [
  'otp',
  'order_accepted',
  'order_rejected',
  'order_ready',
  'birthday',
  'plan_expiring',
  'low_credits',
  'payment_reviewed',
  'campaign',
] as const;
export type SmsTemplate = (typeof SMS_TEMPLATES)[number];

export const MEAL_SLOTS = ['pre_workout', 'post_workout', 'meal', 'snack'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const MEAL_SLOT_LABELS: Labels<typeof MEAL_SLOTS> = {
  pre_workout: 'قبل تمرین',
  post_workout: 'بعد تمرین',
  meal: 'وعده اصلی',
  snack: 'میان‌وعده',
};

export const ANALYTICS_EVENTS = [
  'menu_view',
  'item_view',
  'add_to_cart',
  'checkout_start',
  'order_placed',
  'suggestion_shown',
  'suggestion_click',
  'plan_view',
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
