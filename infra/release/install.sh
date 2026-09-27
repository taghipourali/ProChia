#!/bin/sh
# Installs or updates ProChia from this bundle. Nothing is downloaded: the images, the compose file
# and the Windows installer are all here. The server only needs Docker, which Ubuntu ships:
#   sudo apt install docker.io docker-compose-v2
set -eu
cd "$(dirname "$0")"

if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose is missing. On Ubuntu: sudo apt install docker.io docker-compose-v2' >&2
  exit 1
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo 'Created .env. Fill in ROOT_DOMAIN, DB_PASSWORD, APP_SECRET and the SMS and payment settings,' >&2
  echo 'then run ./install.sh again.' >&2
  exit 1
fi
if grep -q 'change-me' .env; then
  echo 'Replace every change-me value in .env first.' >&2
  exit 1
fi

echo 'Loading images…'
docker load -i images.tar.gz
docker compose --env-file .env up -d --remove-orphans
# Layers of the version this one replaced.
docker image prune -f >/dev/null
echo 'ProChia is running. Staff download the Windows app from https://panel.<ROOT_DOMAIN>.'
