# ProChia
---

A multi-gym food platform for ProChia, a sports-nutrition restaurant and café that lives inside gyms.
Persian, right-to-left and built for Iranian infrastructure (Zarinpal, Kavenegar, Jalali dates, toman).

## What is in the box

| App               | Who uses it                                  | What it does                                                                                                                                   |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | Gym members, on their phone                  | QR menu with full nutrition, goal filters, personalised suggestions, pre-orders, live order tracking, wallet, packages, club, nutrition report |
| `apps/panel`      | Restaurant, café, storage, cashier, managers | Live order board, stock and processing, menu and recipes, members, club and promotions, packages, SMS, reports, settings                       |
| `apps/desktop`    | Same staff, on Windows PCs                   | The panel as a native Windows app (Tauri): installer, native notifications, single instance                                                    |
| `apps/api`        | Both apps                                    | Fastify + PostgreSQL. Orders, inventory, payments, wallet, plans, club, SMS, scheduler, analytics                                              |
| `apps/demo`       | Clients, before launch                       | Static demo for GitHub Pages: both apps plus the real API routes and services running in the browser on PGlite                                 |
| `packages/shared` | Everything                                   | Persian formatting, Jalali calendar, nutrition math, enums, request schemas, API types                                                         |
| `packages/ui`     | Both front-ends                              | Design tokens, self-hosted Estedad font, icons, nutrition label, sheets, toasts                                                                |

## How an order flows

1. A member scans a table QR (or opens `<gym>.prochia.ir`), sees each item's calories and macros, and orders now or for a pickup time.
2. The **restaurant (first floor) accepts** the order. Acceptance deducts every ingredient of every recipe from stock. If something is short, staff see exactly what, and can strike items (the difference is refunded to the wallet) or override.
3. Only then do the **café (ground floor)** and the kitchen get their tickets, so nobody makes a coffee for an order that will be rejected. Pre-orders are released to each station just in time for pickup.
4. When every station is done the member gets an SMS; the counter hands over and collects payment if it was not paid online.

More detail in [docs/architecture.md](docs/architecture.md).

## Run it locally

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
createdb prochia                      # or use docker for Postgres
cp apps/api/.env.example apps/api/.env
pnpm db:seed --reset                  # demo gym with 3 weeks of history
pnpm dev:api                          # http://localhost:4000
pnpm dev:web                          # http://localhost:5173  (member site)
pnpm dev:panel                        # http://localhost:5174  (staff panel)
```

Demo logins (after seeding):

- Staff panel: `owner`, `manager`, `kitchen`, `barista`, `storage`, `cashier` — password `prochia1234`
- Member site: `09121111111` (VIP, cut plan) and `09122222222`…`09128888888`. With `DEV_ECHO_OTP=true` the SMS code appears on screen and in the API log. `09129999999` is a sign-up waiting for approval.

The development payment gateway is a fake bank page with "success / cancel" buttons; it refuses to run in production.

## Tests

```bash
createdb prochia_test
pnpm test        # shared utilities + API (pricing, suggestions, full order flows on real Postgres, HTTP) + demo smoke test
pnpm typecheck
TEST_DB_DRIVER=pglite pnpm --filter @prochia/api test   # the API suite without a Postgres server
```

## Windows app

`pnpm dev:desktop` runs it locally on Windows. Installers (`.exe`, `.msi`) are built by the **Windows app** GitHub Action (run it from the Actions tab or push a `desktop-v*` tag). On first launch the app asks for the server address, e.g. `https://panel.prochia.ir`.

## Demo for clients

`pnpm build:demo` builds `apps/demo/dist`: a landing page with the member app in a phone frame beside the staff panel, all working with no server. A service worker answers `/api` in the browser by running the unchanged API routes and services on [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly), starting from the seed's three weeks of history moved to today. Orders placed in the member app reach the kitchen board live; everything a visitor does stays in their browser, and “restoring dataا” restores the sample data.

The **Demo** GitHub Action publishes it to GitHub Pages on every push to the default branch (one-time: Settings → Pages → Source: GitHub Actions). Serve `dist/` from any static host to show it elsewhere.

## Deploying

Docker Compose stack in `infra/` (Postgres, API, nginx serving both apps with wildcard subdomains). See [docs/deployment.md](docs/deployment.md) for DNS, TLS, SMS and payment-gateway setup in Iran.

## Replacing placeholders

- **Font**: change `--font-sans` in `packages/ui/src/styles.css` (and swap the `@fontsource` import for your font files).
- **Logo**: `Wordmark` in `packages/ui/src/components/primitives.tsx` and `apps/*/public/icon.svg`; desktop icons via `pnpm --filter @prochia/desktop icons` from a 1024 px PNG.
- **Photos**: upload per item in the panel (Menu → item). Until then the menu shows each dish's protein as its "photo".
- **Menu, prices, nutrition, stock**: all editable in the panel; the seed is only a starting point.
