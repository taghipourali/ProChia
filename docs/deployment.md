# Deployment (Iran)

## Staying up when the internet is restricted

Iran's international links are throttled or cut at times while the domestic network keeps working.
ProChia is built so that nothing members or staff do depends on a foreign service:

- **Host in an Iranian data center** (any Iranian VPS). Members' phones and the gym's PCs reach it over
  the domestic network even when international traffic is down.
- **Use a `.ir` domain with Iranian DNS** (nic.ir or ArvanCloud DNS). A foreign DNS provider can stop
  resolving during a cut-off even if the server is fine.
- **At runtime the platform only calls Kavenegar (SMS) and Zarinpal (payments)**, both domestic. Fonts
  are self-hosted; there are no maps, analytics scripts, CDNs or push services from abroad.
- **Installing and updating need no foreign internet on the server**: releases are one bundle with
  prebuilt images (below). Docker itself comes from the Ubuntu archive, which Iranian providers mirror.
- **Staff work in the Windows app**, which contains the whole panel and only exchanges data with the
  server. Its installer includes the WebView2 runtime, so it installs without Microsoft's servers,
  and staff download it from the server itself (`https://panel.<domain>`).
- **Certificates**: Let's Encrypt renews over the international link, so a long cut-off can let a
  certificate expire. For resilience use a one-year certificate from an Iranian reseller or
  ArvanCloud's edge certificate.
- **Clock**: point the server at an Iranian NTP pool (`ir.pool.ntp.org`) so order times stay right.
- **The gym's own connection** is now the weak point for the kitchen: a cheap 4G/TD-LTE modem as a
  backup line keeps the board running when the gym's ADSL/fibre is down.

## Server

Ubuntu 22.04 or 24.04 on an Iranian VPS: 2 vCPU, 4 GB RAM and 40 GB SSD is plenty for several gyms.

```bash
sudo apt install docker.io docker-compose-v2   # from the Ubuntu mirror, no Docker Hub needed
```

**From a release bundle (recommended).** The **Release** GitHub Action (push a tag like `v0.1.0`, or
run it from the Actions tab) produces `prochia-<version>.tar`: images, compose file, `install.sh` and
the Windows installer. Download it once, copy it to the server, and:

```bash
tar xf prochia-v0.1.0.tar && cd prochia-v0.1.0
./install.sh          # first run creates .env; fill it in and run again
docker compose exec api node dist/seed.js   # optional demo data
```

To update, unpack the new bundle, move `.env` into it and run `./install.sh`; data lives in Docker
volumes and is kept. The API applies database migrations on start.

**From source.** Building on the server needs npm and a registry mirror (Docker Hub is blocked): set
`IMAGE_REGISTRY` in `infra/.env` (e.g. `docker.arvancloud.ir`), configure the same mirror for the
Docker daemon, and run

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.build.yml --env-file infra/.env up -d --build
```

## Domains

- `A` record for `prochia.ir` and a **wildcard** `*.prochia.ir` to the server.
- `panel.prochia.ir` serves the API to the Windows app and its download page; every other subdomain is
  a gym's member site (`arena.prochia.ir`).
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

The release bundle puts the installer on the server; staff open `https://panel.prochia.ir` in a browser
once, download it, and on first launch enter that same address. Kitchen thermal printers installed in
Windows appear in the print dialog of "چاپ فیش" on each order. To build only the installer, run the
**Windows app** GitHub Action.

## Backups

Back up the `pgdata` volume (or `pg_dump`) daily and the `uploads` volume (menu photos).
