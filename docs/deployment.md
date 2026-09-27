# Deployment (Iran)

## Server

Any Iranian VPS with Docker. Docker Hub is blocked, so pull through a mirror: set `IMAGE_REGISTRY` in
`infra/.env` (for example `docker.arvancloud.ir`) and configure the same mirror for the Docker daemon.

```bash
cp infra/.env.example infra/.env        # fill in the values
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
docker compose -f infra/docker-compose.yml exec api node dist/seed.js   # optional demo data
```

The API applies database migrations on start.

## Domains

- `A` record for `prochia.ir` and a **wildcard** `*.prochia.ir` to the server.
- `panel.prochia.ir` is the staff panel; every other subdomain is a gym (`arena.prochia.ir`).
- New gyms are created by the owner in the panel (Settings → Gyms); no DNS change is needed.

## TLS

Use a wildcard certificate for `*.prochia.ir` (Let's Encrypt DNS-01 via your DNS provider, or your CDN's
edge certificate if you proxy through ArvanCloud). Terminate TLS in front of the `web` container or add a
`listen 443 ssl` block to `infra/nginx/prochia.conf.template`. Keep `COOKIE_SECURE=true` in production.

## SMS (Kavenegar)

Set `KAVENEGAR_API_KEY` and a dedicated sender line. Create a _verify lookup_ template for login codes
(one token, e.g. `کد ورود پروچیا: %token`) and set `KAVENEGAR_OTP_TEMPLATE`; lookup messages are delivered
faster and are not blocked as advertising. Campaign messages automatically include «لغو۱۱».

## Online payment (Zarinpal)

Zarinpal requires an approved merchant: a registered business, the domain, and usually an **eNamad**
(اینماد) trust seal on the site. Put the merchant id in `ZARINPAL_MERCHANT_ID`. Callbacks return to the
gym's own subdomain, so the member stays logged in. For testing use `ZARINPAL_SANDBOX=true`.

Card-to-card, counter payment, wallet and VIP post-pay work without a gateway.

## Windows app

Build the installer with the **Windows app** GitHub Action and install it on the restaurant, café and
storage PCs. On first launch enter `https://panel.prochia.ir`. Kitchen thermal printers installed in
Windows appear in the print dialog of "چاپ فیش" on each order.

## Backups

Back up the `pgdata` volume (or `pg_dump`) daily and the `uploads` volume (menu photos).
