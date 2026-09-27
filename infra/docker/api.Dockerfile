# syntax=docker/dockerfile:1
# Build context: repository root.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @prochia/api...
RUN pnpm --filter @prochia/api build \
 && pnpm --filter @prochia/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/package.json ./package.json
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 4000
# Migrations run on start; the seed is manual: `docker compose exec api node dist/seed.js`.
CMD ["node", "dist/main.js"]
