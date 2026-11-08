# =====================================================================
#  CoopLink — Docker build ya Railway (badala ya Railpack)
#  Railpack inapakua "mise" kutoka GitHub ili kusakinisha Node; GitHub ikichelewa (504) build inafeli.
#  Hapa Node 20 inatoka kwenye image rasmi ya Node — hakuna mise wala upakuaji kutoka GitHub.
#  Mchakato ni ule ule wa project: npm ci (lockfile) -> npm run build -> node dist/server.js
# =====================================================================

# ---------- 1. BUILD: API (tsc) + admin (Vite) ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Dependencies kwanza (cache), kwa lockfile hasa
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY admin/package.json admin/package-lock.json ./admin/
RUN npm --prefix admin ci --include=dev

# Code yote, kisha build ile ile ya package.json (build:api + build:admin)
COPY . .
RUN npm run build

# Kwa runtime: ondoa devDependencies za backend (admin inahitaji dist tu)
RUN npm prune --omit=dev

# ---------- 2. RUNTIME ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/admin/dist ./admin/dist
COPY --from=build /app/admin/package.json ./admin/package.json
# Migrations zinasomwa na server (dist/db/migrator.js -> ../../drizzle)
COPY --from=build /app/drizzle ./drizzle

USER node
# Railway inaweka PORT; server inasoma process.env.PORT (src/config/env.ts)
EXPOSE 4000
CMD ["node", "dist/server.js"]
