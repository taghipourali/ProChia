# syntax=docker/dockerfile:1
# Builds the member site and the staff panel, and serves both (plus the API proxy) with nginx.
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/panel ./apps/panel
RUN pnpm install --frozen-lockfile --filter @prochia/web... --filter @prochia/panel...
RUN pnpm --filter @prochia/web build && pnpm --filter @prochia/panel build

FROM ${NGINX_IMAGE}
COPY --from=build /repo/apps/web/dist /srv/web
COPY --from=build /repo/apps/panel/dist /srv/panel
COPY infra/nginx/prochia.conf.template /etc/nginx/templates/default.conf.template
