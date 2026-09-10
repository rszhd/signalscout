# One image runs the API, the worker and the migrator. Which one it is depends
# on the command, not on the build. See STACK.md, "Deployment".

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- dependencies -----------------------------------------------------------
# Only the manifests are copied, so a source change does not reinstall.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
# The admin panel. A workspace project whose manifest is missing here installs
# nothing, and `pnpm build` then fails at `vite: not found` — which no local
# build can show, because a developer's install already made its node_modules.
COPY admin/package.json admin/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm build

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/core/drizzle packages/core/drizzle
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/admin/dist admin/dist

# The test files are compiled with everything else. They import vitest, which
# is not installed here, so remove them rather than ship a broken import.
RUN find packages apps \( -name '*.test.js' -o -name '*.test.d.ts' -o -name '*.test.js.map' \) \
    -exec rm -f {} +

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
