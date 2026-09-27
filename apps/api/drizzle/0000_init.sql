CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'high', 'athlete');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('member', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'sent');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('cut', 'recomp', 'maintain', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."ingredient_kind" AS ENUM('raw', 'prepared');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."nutrition_source" AS ENUM('manual', 'recipe');--> statement-breakpoint
CREATE TYPE "public"."order_payment_state" AS ENUM('unpaid', 'paid', 'postpaid', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('app', 'qr', 'staff', 'subscription');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'placed', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('dine_in', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('gateway', 'wallet', 'card_to_card', 'counter', 'postpaid');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('order', 'wallet_topup', 'plan_purchase', 'postpaid_settlement');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'awaiting_review', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."plan_kind" AS ENUM('package', 'meal_plan');--> statement-breakpoint
CREATE TYPE "public"."promotion_audience" AS ENUM('all', 'tier', 'goal', 'first_order', 'personal');--> statement-breakpoint
CREATE TYPE "public"."promotion_kind" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('member', 'staff');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sms_template" AS ENUM('otp', 'order_accepted', 'order_rejected', 'order_ready', 'birthday', 'plan_expiring', 'low_credits', 'payment_reviewed', 'campaign');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'manager', 'restaurant', 'cafe', 'storage', 'cashier');--> statement-breakpoint
CREATE TYPE "public"."stock_reason" AS ENUM('purchase', 'production_in', 'production_out', 'sale', 'sale_reversal', 'waste', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending_payment', 'active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('held', 'scheduled', 'queued', 'preparing', 'ready', 'served', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."training_time" AS ENUM('morning', 'noon', 'afternoon', 'evening', 'night');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('g', 'ml', 'pcs');--> statement-breakpoint
CREATE TYPE "public"."wallet_entry_kind" AS ENUM('topup', 'bonus', 'order', 'refund', 'plan_purchase', 'postpaid_settlement', 'adjustment');--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"gym_name" text NOT NULL,
	"address" text,
	"phone" varchar(20),
	"instagram" varchar(60),
	"whatsapp" varchar(20),
	"card_number" varchar(19),
	"card_holder" text,
	"opening_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{"memberApproval":"manual","autoAccept":false,"enforceStock":true,"preorderMaxDays":3,"preorderMinLeadMinutes":20,"tierWindowDays":90,"birthdayPromotionId":null,"lowCreditsThreshold":2}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"label" text NOT NULL,
	"station_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spots_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" text NOT NULL,
	"floor_label" text,
	"is_acceptance" boolean DEFAULT false NOT NULL,
	"default_prep_minutes" smallint DEFAULT 10 NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "stations_branchId_code_unique" UNIQUE("branch_id","code")
);
--> statement-breakpoint
CREATE TABLE "health_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"height_cm" numeric(5, 1) NOT NULL,
	"weight_kg" numeric(5, 1) NOT NULL,
	"body_fat_pct" numeric(4, 1),
	"activity" "activity_level" NOT NULL,
	"goal" "goal" NOT NULL,
	"training_time" "training_time" NOT NULL,
	"training_days_per_week" smallint NOT NULL,
	"meals_per_day" smallint DEFAULT 4 NOT NULL,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"diet_preferences" text[] DEFAULT '{}' NOT NULL,
	"targets" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_whitelist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"phone" varchar(11) NOT NULL,
	"gym_member_code" varchar(32),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_whitelist_branchId_phone_unique" UNIQUE("branch_id","phone")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'pending' NOT NULL,
	"gym_member_code" varchar(32),
	"tier_id" uuid,
	"is_vip" boolean DEFAULT false NOT NULL,
	"credit_limit" bigint DEFAULT 0 NOT NULL,
	"personal_discount_pct" smallint DEFAULT 0 NOT NULL,
	"wallet_balance" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_branchId_userId_unique" UNIQUE("branch_id","user_id"),
	CONSTRAINT "wallet_non_negative" CHECK ("memberships"."wallet_balance" >= 0),
	CONSTRAINT "personal_discount_range" CHECK ("memberships"."personal_discount_pct" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(11) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"kind" "session_kind" NOT NULL,
	"user_id" uuid,
	"staff_id" uuid,
	"branch_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"user_agent" text,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "session_subject" CHECK (("sessions"."kind" = 'member' and "sessions"."user_id" is not null) or ("sessions"."kind" = 'staff' and "sessions"."staff_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"username" varchar(40) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(11) NOT NULL,
	"first_name" text,
	"last_name" text,
	"birth_date" date,
	"sex" "sex",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "weight_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"weight_kg" numeric(5, 1) NOT NULL,
	"logged_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_logs_userId_loggedOn_unique" UNIQUE("user_id","logged_on")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_item_modifier_groups" (
	"menu_item_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_item_modifier_groups_menu_item_id_group_id_pk" PRIMARY KEY("menu_item_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" bigint NOT NULL,
	"image_url" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"kcal" numeric(7, 1) DEFAULT 0 NOT NULL,
	"protein" numeric(6, 1) DEFAULT 0 NOT NULL,
	"carbs" numeric(6, 1) DEFAULT 0 NOT NULL,
	"fat" numeric(6, 1) DEFAULT 0 NOT NULL,
	"fiber" numeric(6, 1) DEFAULT 0 NOT NULL,
	"sugar" numeric(6, 1) DEFAULT 0 NOT NULL,
	"sodium" numeric(7, 1) DEFAULT 0 NOT NULL,
	"serving_grams" numeric(6, 1),
	"nutrition_source" "nutrition_source" DEFAULT 'manual' NOT NULL,
	"prep_minutes" smallint DEFAULT 10 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"credit_eligible" boolean DEFAULT true NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_select" smallint DEFAULT 0 NOT NULL,
	"max_select" smallint DEFAULT 1 NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modifier_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta" bigint DEFAULT 0 NOT NULL,
	"kcal" numeric(7, 1) DEFAULT 0 NOT NULL,
	"protein" numeric(6, 1) DEFAULT 0 NOT NULL,
	"carbs" numeric(6, 1) DEFAULT 0 NOT NULL,
	"fat" numeric(6, 1) DEFAULT 0 NOT NULL,
	"fiber" numeric(6, 1) DEFAULT 0 NOT NULL,
	"sugar" numeric(6, 1) DEFAULT 0 NOT NULL,
	"sodium" numeric(7, 1) DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" uuid,
	"modifier_option_id" uuid,
	"ingredient_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	CONSTRAINT "recipe_line_owner" CHECK (num_nonnulls("recipe_lines"."menu_item_id", "recipe_lines"."modifier_option_id") = 1),
	CONSTRAINT "recipe_line_quantity" CHECK ("recipe_lines"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "ingredient_kind" NOT NULL,
	"unit" "unit" NOT NULL,
	"nutrition" jsonb,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"on_hand" numeric(12, 2) DEFAULT 0 NOT NULL,
	"avg_cost" numeric(14, 4) DEFAULT 0 NOT NULL,
	"low_stock_threshold" numeric(12, 2) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredients_branchId_name_unique" UNIQUE("branch_id","name")
);
--> statement-breakpoint
CREATE TABLE "prep_recipe_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prep_recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prep_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"output_ingredient_id" uuid NOT NULL,
	"output_quantity" numeric(12, 2) NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_run_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"prep_recipe_id" uuid,
	"output_ingredient_id" uuid NOT NULL,
	"output_quantity" numeric(12, 2) NOT NULL,
	"total_cost" bigint NOT NULL,
	"staff_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"line_cost" bigint NOT NULL,
	"expires_on" date
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier" text,
	"invoice_no" varchar(40),
	"total_cost" bigint NOT NULL,
	"staff_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"delta" numeric(12, 2) NOT NULL,
	"balance_after" numeric(12, 2) NOT NULL,
	"reason" "stock_reason" NOT NULL,
	"unit_cost" numeric(14, 4),
	"ref_type" varchar(20),
	"ref_id" uuid,
	"staff_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"credits" smallint NOT NULL,
	"value" bigint NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_counters" (
	"branch_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "order_counters_branch_id_business_date_pk" PRIMARY KEY("branch_id","business_date")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_price" bigint NOT NULL,
	"quantity" smallint NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"line_total" bigint NOT NULL,
	"credits_used" smallint DEFAULT 0 NOT NULL,
	"nutrition" jsonb NOT NULL,
	"note" text,
	"removed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"business_date" date NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "order_type" NOT NULL,
	"spot_id" uuid,
	"scheduled_for" timestamp with time zone,
	"status" "order_status" NOT NULL,
	"payment_state" "order_payment_state" DEFAULT 'unpaid' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"subtotal" bigint NOT NULL,
	"credits_value" bigint DEFAULT 0 NOT NULL,
	"member_discount_pct" smallint DEFAULT 0 NOT NULL,
	"member_discount" bigint DEFAULT 0 NOT NULL,
	"promo_discount" bigint DEFAULT 0 NOT NULL,
	"promotion_id" uuid,
	"total" bigint NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	"nutrition" jsonb NOT NULL,
	"note" text,
	"reject_reason" text,
	"source" "order_source" DEFAULT 'app' NOT NULL,
	"subscription_id" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"ready_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"rating" smallint,
	"rating_comment" text,
	"rated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_branchId_businessDate_number_unique" UNIQUE("branch_id","business_date","number"),
	CONSTRAINT "order_total_non_negative" CHECK ("orders"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "station_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"status" "ticket_status" NOT NULL,
	"due_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_tickets_orderId_stationId_unique" UNIQUE("order_id","station_id")
);
--> statement-breakpoint
CREATE TABLE "cashback_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"min_amount" bigint NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"max_bonus" bigint,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment_status" NOT NULL,
	"order_id" uuid,
	"subscription_id" uuid,
	"gateway" varchar(20),
	"authority" varchar(64),
	"ref_id" varchar(64),
	"card_pan" varchar(20),
	"tracking_code" varchar(32),
	"card_last4" varchar(4),
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payments_gateway_authority_unique" UNIQUE("gateway","authority"),
	CONSTRAINT "payment_amount_positive" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"kind" "wallet_entry_kind" NOT NULL,
	"payment_id" uuid,
	"order_id" uuid,
	"staff_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" "plan_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"goal" "goal",
	"meals" integer NOT NULL,
	"validity_days" integer NOT NULL,
	"price" bigint NOT NULL,
	"compare_at_price" bigint,
	"meals_per_day" smallint,
	"eligible_category_ids" uuid[] DEFAULT '{}' NOT NULL,
	"max_item_price" bigint,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"credits" integer NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"starts_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"price_paid" bigint NOT NULL,
	"schedule" jsonb,
	"last_auto_order_on" date,
	"expiry_reminded_at" timestamp with time zone,
	"low_credits_reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credits_within_total" CHECK ("subscriptions"."credits_used" between 0 and "subscriptions"."credits")
);
--> statement-breakpoint
CREATE TABLE "member_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"reason" varchar(20) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promotion_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"member_code_id" uuid,
	"amount" bigint NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" "promotion_kind" NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"max_discount" bigint,
	"min_order" bigint DEFAULT 0 NOT NULL,
	"code" varchar(32),
	"audience" "promotion_audience" DEFAULT 'all' NOT NULL,
	"tier_id" uuid,
	"goal" "goal",
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"per_member_limit" integer DEFAULT 1 NOT NULL,
	"personal_code_days" smallint DEFAULT 7 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_branchId_code_unique" UNIQUE("branch_id","code")
);
--> statement-breakpoint
CREATE TABLE "tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_spend" bigint NOT NULL,
	"discount_pct" smallint DEFAULT 0 NOT NULL,
	"perks" text,
	"sort" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid,
	"anon_id" varchar(64),
	"name" varchar(40) NOT NULL,
	"props" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid,
	"phone" varchar(11) NOT NULL,
	"template" "sms_template" NOT NULL,
	"body" text NOT NULL,
	"tokens" jsonb,
	"status" "sms_status" DEFAULT 'queued' NOT NULL,
	"provider" varchar(20),
	"provider_message_id" varchar(64),
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spots" ADD CONSTRAINT "spots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots" ADD CONSTRAINT "spots_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_profiles" ADD CONSTRAINT "health_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_whitelist" ADD CONSTRAINT "member_whitelist_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_group_id_modifier_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_group_id_modifier_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_modifier_option_id_modifier_options_id_fk" FOREIGN KEY ("modifier_option_id") REFERENCES "public"."modifier_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_recipe_inputs" ADD CONSTRAINT "prep_recipe_inputs_prep_recipe_id_prep_recipes_id_fk" FOREIGN KEY ("prep_recipe_id") REFERENCES "public"."prep_recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_recipe_inputs" ADD CONSTRAINT "prep_recipe_inputs_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_recipes" ADD CONSTRAINT "prep_recipes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_recipes" ADD CONSTRAINT "prep_recipes_output_ingredient_id_ingredients_id_fk" FOREIGN KEY ("output_ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_run_id_production_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."production_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_inputs" ADD CONSTRAINT "production_run_inputs_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_prep_recipe_id_prep_recipes_id_fk" FOREIGN KEY ("prep_recipe_id") REFERENCES "public"."prep_recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_output_ingredient_id_ingredients_id_fk" FOREIGN KEY ("output_ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_redemptions" ADD CONSTRAINT "credit_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_redemptions" ADD CONSTRAINT "credit_redemptions_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_redemptions" ADD CONSTRAINT "credit_redemptions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "public"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_accepted_by_staff_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_tickets" ADD CONSTRAINT "station_tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_tickets" ADD CONSTRAINT "station_tickets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_tickets" ADD CONSTRAINT "station_tickets_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashback_rules" ADD CONSTRAINT "cashback_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_codes" ADD CONSTRAINT "member_codes_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_codes" ADD CONSTRAINT "member_codes_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_member_code_id_member_codes_id_fk" FOREIGN KEY ("member_code_id") REFERENCES "public"."member_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_outbox" ADD CONSTRAINT "sms_outbox_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_branch_id_status_index" ON "memberships" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "otp_codes_phone_created_at_index" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "menu_items_branch_id_category_id_index" ON "menu_items" USING btree ("branch_id","category_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_menu_item_id_index" ON "recipe_lines" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_modifier_option_id_index" ON "recipe_lines" USING btree ("modifier_option_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_ingredient_id_index" ON "recipe_lines" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "production_runs_branch_id_created_at_index" ON "production_runs" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_ingredient_id_created_at_index" ON "stock_movements" USING btree ("ingredient_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_branch_id_created_at_index" ON "stock_movements" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_ref_type_ref_id_index" ON "stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "credit_redemptions_subscription_id_index" ON "credit_redemptions" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "credit_redemptions_order_id_index" ON "credit_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_id_created_at_index" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_lines_order_id_index" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_branch_id_status_index" ON "orders" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "orders_membership_id_created_at_index" ON "orders" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_branch_id_created_at_index" ON "orders" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "station_tickets_branch_id_station_id_status_index" ON "station_tickets" USING btree ("branch_id","station_id","status");--> statement-breakpoint
CREATE INDEX "payments_branch_id_status_index" ON "payments" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "payments_membership_id_created_at_index" ON "payments" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_order_id_index" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "wallet_entries_membership_id_created_at_index" ON "wallet_entries" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE INDEX "subscriptions_membership_id_status_index" ON "subscriptions" USING btree ("membership_id","status");--> statement-breakpoint
CREATE INDEX "member_codes_membership_id_index" ON "member_codes" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "promotion_redemptions_promotion_id_index" ON "promotion_redemptions" USING btree ("promotion_id");--> statement-breakpoint
CREATE INDEX "promotion_redemptions_membership_id_index" ON "promotion_redemptions" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "events_branch_id_name_created_at_index" ON "events" USING btree ("branch_id","name","created_at");--> statement-breakpoint
CREATE INDEX "sms_outbox_status_send_after_index" ON "sms_outbox" USING btree ("status","send_after");