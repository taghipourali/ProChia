# syntax=docker/dockerfile:1
# Builds the member site and serves it, the API proxy and the staff download page with nginx.
# (The staff panel itself ships inside the Windows app.)
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# The member site imports the static demo's bootstrap, which production builds leave out.
COPY apps/demo ./apps/demo
RUN pnpm install --frozen-lockfile --filter @prochia/web...
RUN pnpm --filter @prochia/web build
RUN mkdir -p /out/fonts \
 && cp packages/ui/node_modules/@fontsource-variable/estedad/files/estedad-arabic-wght-normal.woff2 \
       packages/ui/node_modules/@fontsource-variable/estedad/files/estedad-latin-wght-normal.woff2 /out/fonts/

FROM ${NGINX_IMAGE}
COPY --from=build /repo/apps/web/dist /srv/web
COPY infra/nginx/panel-home /srv/panel-home
COPY --from=build /out/fonts /srv/panel-home/fonts
COPY infra/nginx/prochia.conf.template /etc/nginx/templates/default.conf.template
