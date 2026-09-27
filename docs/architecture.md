# Architecture

## Tenancy

A **branch** is one ProChia kitchen inside one gym, served at `<slug>.<ROOT_DOMAIN>`. The API reads the
branch from the `Host` header (or `X-Branch`, or `?branch=` for event streams). Everything a branch owns
— menu, stock, orders, members' wallets, plans, promotions — carries `branch_id`, and every staff query
filters on the staff member's branch. Users (phone numbers) are global; a **membership** ties a user to
a branch and holds their approval state, wallet, VIP credit and club tier, so each gym keeps its own books.

Only gym members may order. New sign-ups are approved automatically if their number is on the gym's
member list (imported by reception), otherwise they wait for staff approval — configurable per branch.

## Stations and the order lifecycle

Each branch has **stations** (restaurant upstairs, café downstairs). Exactly one is the **acceptance
station**.

```
placed ──accept──▶ accepted ──first ticket starts──▶ preparing ──all tickets ready──▶ ready ──handover──▶ completed
   │                   │
   └──reject/cancel────┴──▶ rejected / cancelled   (stock returned, money to wallet, credits and codes restored)
```

- On placement every station gets a **held** ticket. Held tickets are visible (greyed) on the café's
  board so it can see what is coming, but cannot be started.
- **Acceptance** happens in one transaction: lock the order, optionally strike lines (recompute totals,
  refund the difference to the wallet), deduct stock for the remaining recipes, then release tickets as
  `queued` — or `scheduled` with a `due_at` for pre-orders (pickup time minus the station's prep time).
  The café role can accept only orders that contain nothing from the acceptance station.
- A scheduler moves `scheduled` tickets to `queued` when they are due.
- `handover` requires the order to be paid, or collects payment at the counter in the same step.
- Branches may enable **auto-accept**: if stock covers the order it is accepted by the system.

Every transition writes an `order_events` row; service-time analytics are built from those timestamps.

## Inventory

- `ingredients` are **raw** (bought) or **prepared** (made in-house). `on_hand` is kept in step with the
  append-only `stock_movements` ledger inside the same transaction, with row locks taken in id order so
  concurrent acceptances cannot deadlock. Incoming stock updates a weighted-average cost.
- **Recipes** (`recipe_lines`) belong to a menu item or to a modifier option. Options can carry negative
  lines to express swaps (almond milk instead of milk).
- **Processing** (`prep_recipes`, `production_runs`) turns raw into prepared ingredients with the real
  yield recorded each time; the output's cost is the inputs' cost divided by the actual yield, so trim
  loss shows up in dish costs.
- **Availability**: free stock = on hand − what orders still awaiting acceptance will consume. The menu
  shows items as sold out (or "only N left") from that, live.

## Money

All amounts are integer toman.

- **Pricing** (`orders/pricing.ts`, pure): credits from packages cover eligible items (most expensive
  units first, soonest-expiring package first, capped at the plan's max item price); then the member
  discount (best of personal and tier); then one promotion (typed code, personal code, or the best
  automatic one).
- **Payment methods**: Zarinpal gateway (the fake gateway in development), wallet, card-to-card (reviewed by
  the cashier), pay at the counter, and VIP post-pay within a credit limit.
- **Wallet** is a ledger (`wallet_entries`) with a running balance on the membership (never negative).
  Top-ups earn the best matching **cashback** tier. Every refund goes to the wallet.
- A card-to-card payment approved after its order was cancelled is refunded to the wallet automatically.

## Plans

`package` plans sell N meal credits valid for D days; `meal_plan`s add a goal and an optional daily
schedule. For scheduled days the scheduler places the order four hours before pickup — either rotating the
member's chosen dishes or picking the best goal-matched dish that the credits fully cover.

## Personalisation

The health profile (sex, birth date, height, weight, optional body fat, activity, goal, training time,
allergies and diet) gives daily targets: Katch–McArdle with body fat, Mifflin–St Jeor otherwise, adjusted
for the goal; protein per kg by goal, dosed on a capped reference weight for high BMI. Suggestions score
available items against the target for the current meal slot (derived from the training time), shrunk to
what is left of today's budget, with the member's history (reorders up, bad ratings down). Each suggestion
explains itself in Persian.

## Background work

One API process runs the scheduler (Postgres advisory lock): release due tickets, drain the SMS outbox
(retries with back-off), expire abandoned gateway payments, create scheduled plan orders, expire
subscriptions and send reminders, birthday codes (matched on the Jalali calendar), tier refresh.

## Realtime

Staff and member screens subscribe to server-sent events. The in-process bus serves one API instance;
running several would put Postgres `LISTEN/NOTIFY` behind the same `EventBus` interface.
