/**
 * JSON shapes returned by the API, as the apps receive them (dates are ISO strings).
 * Keep in step with the API read models.
 */
import type {
  ActivityLevel,
  Allergen,
  DietPreference,
  Goal,
  IngredientKind,
  ItemTag,
  MealSlot,
  MembershipStatus,
  OrderPaymentState,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  PlanKind,
  Sex,
  StaffRole,
  StockReason,
  SubscriptionStatus,
  TicketStatus,
  TrainingTime,
  Unit,
  WalletEntryKind,
} from './enums';
import type { DailyTargets, MacroTarget, Nutrition } from './nutrition';
import type { SubscriptionScheduleInput } from './schemas';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface BranchDto {
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
  openingHours: Partial<Record<string, [string, string][]>>;
  isOpen: boolean;
  stations: { id: string; name: string; floorLabel: string | null; isAcceptance: boolean }[];
  preorder: { maxDays: number; minLeadMinutes: number };
  memberApproval: 'auto' | 'whitelist' | 'manual';
}

export interface MenuOptionDto {
  id: string;
  name: string;
  priceDelta: number;
  nutrition: Nutrition;
  isDefault: boolean;
  isActive: boolean;
  available: boolean;
}

export interface MenuGroupDto {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOptionDto[];
}

export interface MenuItemDto {
  id: string;
  categoryId: string;
  stationId: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  tags: ItemTag[];
  allergens: Allergen[];
  nutrition: Nutrition;
  servingGrams: number | null;
  nutritionSource: 'manual' | 'recipe';
  prepMinutes: number;
  creditEligible: boolean;
  isPublished: boolean;
  isAvailable: boolean;
  available: boolean;
  portionsLeft: number | null;
  stockTracked: boolean;
  groups: MenuGroupDto[];
}

export interface MenuDto {
  stations: {
    id: string;
    code: string;
    name: string;
    floorLabel: string | null;
    isAcceptance: boolean;
  }[];
  categories: {
    id: string;
    name: string;
    stationId: string;
    isActive: boolean;
    items: MenuItemDto[];
  }[];
}

export interface HealthProfileDto {
  userId: string;
  heightCm: number;
  weightKg: number;
  bodyFatPct: number | null;
  activity: ActivityLevel;
  goal: Goal;
  trainingTime: TrainingTime;
  trainingDaysPerWeek: number;
  mealsPerDay: number;
  allergens: Allergen[];
  dietPreferences: DietPreference[];
  targets: DailyTargets;
  bmi: number;
  bmiBand: 'under' | 'normal' | 'over' | 'obese';
  updatedAt: string;
}

export interface MeDto {
  user: {
    id: string;
    phone: string;
    firstName: string | null;
    lastName: string | null;
    birthDate: string | null;
    sex: Sex | null;
  } | null;
  membership?: {
    id: string;
    status: MembershipStatus;
    isVip: boolean;
    creditLimit: number;
    postpaidOwed: number;
    walletBalance: number;
    personalDiscountPct: number;
    tier: { id: string; name: string; discountPct: number } | null;
  } | null;
  health?: HealthProfileDto | null;
  needsOnboarding?: boolean;
}

export interface QuoteLineDto {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  creditsUsed: number;
  creditValue: number;
  nutrition: Nutrition;
  options: { id: string; groupName: string; name: string; priceDelta: number }[];
}

export interface QuoteDto {
  lines: QuoteLineDto[];
  subtotal: number;
  creditsUsed: number;
  creditsValue: number;
  memberDiscountPct: number;
  memberDiscount: number;
  promotion: { id: string; title: string } | null;
  promoDiscount: number;
  promoError: string | null;
  total: number;
  nutrition: Nutrition;
  prepMinutes: number;
  unavailable: string[];
  wallet: { balance: number };
  postpaid: { allowed: boolean; limit: number; owed: number; available: number };
}

export interface PlaceOrderResultDto {
  orderId: string;
  number: number;
  status: OrderStatus;
  redirectUrl: string | null;
}

export interface OrderLineDto {
  id: string;
  menuItemId: string;
  stationId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  options: { id: string; groupName: string; name: string; priceDelta: number }[];
  lineTotal: number;
  creditsUsed: number;
  nutrition: Nutrition;
  note: string | null;
  removed: boolean;
}

export interface TicketDto {
  id: string;
  stationId: string;
  stationName: string;
  floorLabel: string | null;
  isAcceptance: boolean;
  status: TicketStatus;
  dueAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
}

export interface OrderDto {
  id: string;
  number: number;
  status: OrderStatus;
  type: OrderType;
  source: 'app' | 'qr' | 'staff' | 'subscription';
  scheduledFor: string | null;
  createdAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  paymentState: OrderPaymentState;
  paymentMethod: PaymentMethod;
  subtotal: number;
  creditsValue: number;
  memberDiscount: number;
  promoDiscount: number;
  total: number;
  paidAmount: number;
  nutrition: Nutrition;
  note: string | null;
  rejectReason: string | null;
  rating: number | null;
  ratingComment: string | null;
  spot: { label: string } | null;
  lines: OrderLineDto[];
  tickets: TicketDto[];
  pendingPayment: {
    id: string;
    method: PaymentMethod;
    status: PaymentStatus;
    amount: number;
    trackingCode: string | null;
    cardLast4: string | null;
  } | null;
  member?: { name: string | null; phone: string; isVip: boolean; tierName: string | null };
}

export interface StaffOrderDto extends OrderDto {
  events: {
    id: string;
    type: string;
    actorKind: string;
    createdAt: string;
    data: Record<string, unknown> | null;
  }[];
}

export interface RecommendationDto {
  itemId: string;
  score: number;
  reasons: string[];
  fit: { kcal: number; protein: number };
  item: MenuItemDto;
}

export type RecommendationsDto =
  | { needsProfile: true }
  | {
      needsProfile: false;
      slot: MealSlot;
      target: MacroTarget;
      daily: DailyTargets;
      eatenToday: MacroTarget;
      items: RecommendationDto[];
    };

export interface WalletEntryDto {
  id: string;
  amount: number;
  balanceAfter: number;
  kind: WalletEntryKind;
  note: string | null;
  orderId: string | null;
  createdAt: string;
}

export interface CashbackRuleDto {
  id?: string;
  title: string;
  minAmount: number;
  percent: number;
  maxBonus: number | null;
}

export interface WalletDto {
  balance: number;
  entries: WalletEntryDto[];
  cashback: CashbackRuleDto[];
  postpaid: { limit: number; owed: number } | null;
}

export interface PlanDto {
  id: string;
  kind: PlanKind;
  name: string;
  description: string | null;
  goal: Goal | null;
  meals: number;
  validityDays: number;
  price: number;
  compareAtPrice: number | null;
  mealsPerDay: number | null;
  eligibleCategoryIds: string[];
  maxItemPrice: number | null;
  isFeatured: boolean;
  isActive: boolean;
  sort: number;
  pricePerMeal: number;
  savingPct: number;
}

export interface SubscriptionDto {
  id: string;
  status: SubscriptionStatus;
  credits: number;
  creditsUsed: number;
  remaining: number;
  startsOn: string;
  expiresOn: string;
  pricePaid: number;
  schedule: SubscriptionScheduleInput | null;
  plan: { id: string; name: string; kind: PlanKind; goal: Goal | null; mealsPerDay: number | null };
  createdAt: string;
}

export interface TierDto {
  id: string;
  name: string;
  minSpend: number;
  discountPct: number;
  perks: string | null;
  sort: number;
}

export interface ClubDto {
  tier: TierDto | null;
  next: TierDto | null;
  spend: number;
  windowDays: number;
  toNext: number;
  tiers: TierDto[];
  discountPct: number;
  offers: {
    automatic: {
      id: string;
      title: string;
      kind: 'percent' | 'amount';
      value: number;
      minOrder: number;
      maxDiscount: number | null;
    }[];
    personalCodes: {
      code: string;
      expiresAt: string;
      reason: string;
      title: string;
      kind: 'percent' | 'amount';
      value: number;
    }[];
    publicCodes: {
      code: string;
      title: string;
      description: string | null;
      kind: 'percent' | 'amount';
      value: number;
      minOrder: number;
      endsAt: string | null;
    }[];
  };
}

export interface InsightsDto {
  targets: DailyTargets | null;
  week: {
    date: string;
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    orders: number;
  }[];
  favourites: { menuItemId: string; name: string; count: number }[];
  weights: { date: string; weightKg: number }[];
  lifetime: { orders: number; protein: number; spent: number };
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export interface StaffMeDto {
  staff: { id: string; name: string; username: string; role: StaffRole; branchId: string | null };
  branch: { id: string; slug: string; name: string; gymName: string; settings: BranchSettingsDto };
}

export interface BranchSettingsDto {
  memberApproval: 'auto' | 'whitelist' | 'manual';
  autoAccept: boolean;
  enforceStock: boolean;
  preorderMaxDays: number;
  preorderMinLeadMinutes: number;
  tierWindowDays: number;
  birthdayPromotionId: string | null;
  lowCreditsThreshold: number;
}

export interface StockLevelDto {
  id: string;
  name: string;
  kind: IngredientKind;
  unit: Unit;
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  avgCost: number;
  value: number;
  lowStockThreshold: number;
  isLow: boolean;
  daysLeft: number | null;
  nutrition: Nutrition | null;
  allergens: Allergen[];
}

export interface StockMovementDto {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: Unit;
  delta: number;
  balanceAfter: number;
  reason: StockReason;
  unitCost: number | null;
  refType: string | null;
  refId: string | null;
  note: string | null;
  staffName: string | null;
  createdAt: string;
}

export interface PrepRecipeDto {
  id: string;
  name: string;
  outputIngredientId: string;
  outputQuantity: number;
  note: string | null;
  isActive: boolean;
  inputs: { id: string; ingredientId: string; quantity: number }[];
}

export interface StaffMenuDto extends MenuDto {
  modifierGroups: {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    sort: number;
    options: {
      id: string;
      groupId: string;
      name: string;
      priceDelta: number;
      nutrition: Nutrition;
      isDefault: boolean;
      isActive: boolean;
      sort: number;
      recipe: { ingredientId: string; quantity: number }[];
    }[];
  }[];
  recipes: Record<string, { ingredientId: string; quantity: number }[]>;
  optionRecipes: Record<string, { ingredientId: string; quantity: number }[]>;
}

export interface MemberListItemDto {
  id: string;
  status: MembershipStatus;
  isVip: boolean;
  creditLimit: number;
  personalDiscountPct: number;
  walletBalance: number;
  gymMemberCode: string | null;
  tierName: string | null;
  createdAt: string;
  userId: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  goal: Goal | null;
  lastOrderAt: string | null;
}

export interface PaymentReviewDto {
  payment: {
    id: string;
    purpose: PaymentPurpose;
    method: PaymentMethod;
    amount: number;
    status: PaymentStatus;
    orderId: string | null;
    trackingCode: string | null;
    cardLast4: string | null;
    createdAt: string;
  };
  member: { firstName: string | null; lastName: string | null; phone: string };
}
