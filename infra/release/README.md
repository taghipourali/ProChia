# ProChia server bundle

Everything needed to install or update ProChia on a server in Iran without reaching any foreign
service: prebuilt Docker images, the compose file, and the Windows app installer for staff.

## Install

1. Ubuntu 22.04 or 24.04 with Docker from the Ubuntu archive (your provider's mirror serves it):
   `sudo apt install docker.io docker-compose-v2`
2. Copy this folder to the server, then run `./install.sh` inside it. The first run creates `.env`;
   fill it in and run `./install.sh` again.
3. DNS: `A` records for `prochia.ir` and `*.prochia.ir` (use your `ROOT_DOMAIN`) to the server.
4. Staff open `https://panel.prochia.ir` once to download the Windows app; members use
   `https://<gym>.prochia.ir`.

## Update

Copy the new bundle next to the old one, move `.env` into it, and run `./install.sh`. The database and
menu photos live in Docker volumes and are kept.

See `docs/deployment.md` in the repository for TLS, SMS, payments and backups.
