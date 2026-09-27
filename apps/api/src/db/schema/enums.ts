import { pgEnum } from 'drizzle-orm/pg-core';
import {
  ACTIVITY_LEVELS,
  GOALS,
  INGREDIENT_KINDS,
  MEMBERSHIP_STATUSES,
  ORDER_PAYMENT_STATES,
  ORDER_STATUSES,
  ORDER_TYPES,
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  PLAN_KINDS,
  PROMOTION_AUDIENCES,
  PROMOTION_KINDS,
  SEXES,
  SMS_TEMPLATES,
  STAFF_ROLES,
  STOCK_REASONS,
  SUBSCRIPTION_STATUSES,
  TICKET_STATUSES,
  TRAINING_TIMES,
  UNITS,
  WALLET_ENTRY_KINDS,
} from '@prochia/shared';

export const sexEnum = pgEnum('sex', SEXES);
export const goalEnum = pgEnum('goal', GOALS);
export const activityEnum = pgEnum('activity_level', ACTIVITY_LEVELS);
export const trainingTimeEnum = pgEnum('training_time', TRAINING_TIMES);
export const membershipStatusEnum = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const staffRoleEnum = pgEnum('staff_role', STAFF_ROLES);
export const sessionKindEnum = pgEnum('session_kind', ['member', 'staff']);
export const unitEnum = pgEnum('unit', UNITS);
export const ingredientKindEnum = pgEnum('ingredient_kind', INGREDIENT_KINDS);
export const stockReasonEnum = pgEnum('stock_reason', STOCK_REASONS);
export const nutritionSourceEnum = pgEnum('nutrition_source', ['manual', 'recipe']);
export const orderTypeEnum = pgEnum('order_type', ORDER_TYPES);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const orderPaymentStateEnum = pgEnum('order_payment_state', ORDER_PAYMENT_STATES);
export const orderSourceEnum = pgEnum('order_source', ['app', 'qr', 'staff', 'subscription']);
export const ticketStatusEnum = pgEnum('ticket_status', TICKET_STATUSES);
export const actorKindEnum = pgEnum('actor_kind', ['member', 'staff', 'system']);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const paymentPurposeEnum = pgEnum('payment_purpose', PAYMENT_PURPOSES);
export const walletEntryKindEnum = pgEnum('wallet_entry_kind', WALLET_ENTRY_KINDS);
export const planKindEnum = pgEnum('plan_kind', PLAN_KINDS);
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const promotionKindEnum = pgEnum('promotion_kind', PROMOTION_KINDS);
export const promotionAudienceEnum = pgEnum('promotion_audience', PROMOTION_AUDIENCES);
export const smsTemplateEnum = pgEnum('sms_template', SMS_TEMPLATES);
export const smsStatusEnum = pgEnum('sms_status', ['queued', 'sent', 'failed']);
export const campaignStatusEnum = pgEnum('campaign_status', ['draft', 'sent']);
