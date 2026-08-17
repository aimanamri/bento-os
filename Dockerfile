# syntax=docker/dockerfile:1
#
# Bento OS — production image (multi-stage)
#   deps    → production-only node_modules (express, and nothing else)
#   build   → full deps; compiles CSS, copies static/vendor/PWA assets into
#             dist/, and stamps the service worker with that build's precache
#   runtime → minimal, non-root, read-only; ships dist/ + server/ only
#
# The app is a static host — all data lives in Supabase, so the image carries
# no database and needs no writable path.
#
# The client libs (mermaid, katex, markdown-it, dompurify, supabase-js) are
# build-time-only: they are baked into dist/vendor and served statically, so
# the Node process never require()s them and they must NOT end up in the
# runtime node_modules.

# ---- deps: resolve production dependencies once ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# --omit=optional drops better-sqlite3: it only backs the local-SQLite variant
# and the migrate-sqlite-to-supabase script, neither of which runs in here.
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# ---- build: compile assets ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Which backend the bundle calls. Empty (the default) keeps whatever is
# committed in src/js/supabase-config.js — i.e. the hosted Supabase project.
# The self-hosted compose stack passes its own gateway URL + anon key here, and
# scripts/build-js.js swaps the module in at bundle time WITHOUT editing the
# source file, so the committed cloud config is never disturbed.
ARG BENTO_SUPABASE_URL=""
ARG BENTO_SUPABASE_ANON_KEY=""
ENV BENTO_SUPABASE_URL=$BENTO_SUPABASE_URL \
    BENTO_SUPABASE_ANON_KEY=$BENTO_SUPABASE_ANON_KEY
# The PWA assets come from the build context (src/assets, src/manifest.…) and
# from build:sw, so a .dockerignore change or a missing file degrades the app
# silently: it still boots, it just stops being installable or offline-capable.
# Fail the image build instead.
# The last two assertions guard the obfuscation step (scripts/build-js.js):
# the image must ship exactly one bundle and none of the readable modules it
# was built from, or a build regression quietly republishes the source.
RUN npm run build \
 && node scripts/pin-supabase-config.js \
 && test -s dist/sw.js \
 && test -s dist/manifest.webmanifest \
 && test -s dist/assets/icons/icon-512.png \
 && test -s dist/assets/icons/icon-maskable-512.png \
 && test -s dist/js/app.js \
 && test "$(ls dist/js | wc -l)" -eq 1

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Carried into the runtime so server/index.js pins the CSP connect-src to the
# SAME backend the bundle was built against. Without this the image would ship
# a bundle calling the self-hosted gateway while the CSP still allowed only the
# committed cloud project, and every request would be blocked. Compose can
# still override it at run time.
ARG BENTO_SUPABASE_URL=""
ENV BENTO_SUPABASE_URL=$BENTO_SUPABASE_URL

# tini = PID 1: forwards SIGTERM to Node for a clean shutdown and reaps
# zombies. Non-root user is created up front.
RUN apk add --no-cache tini \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001

# Only the two things the server actually loads at runtime, plus built assets.
COPY --from=deps  --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist    ./dist
COPY --from=build --chown=nodejs:nodejs /app/server  ./server
COPY --chown=nodejs:nodejs package*.json ./
# server/index.js reads SUPABASE_URL from this file to pin the CSP connect-src
# when BENTO_SUPABASE_URL is unset. Without it the CSP would fall back to a
# https://*.supabase.co wildcard.
COPY --from=build --chown=nodejs:nodejs /app/src/js/supabase-config.js ./src/js/supabase-config.js

# The admin bootstrap, so a self-hosted stack can create its first account
# without Node on the host (docker-compose.yml → `setup-admin` service). It is
# never run by the server; it only needs @supabase/supabase-js, which is
# already a production dependency. The other scripts/ are build- or host-only
# and stay out of the image.
COPY --from=build --chown=nodejs:nodejs /app/scripts/setup-supabase-admin.js ./scripts/setup-supabase-admin.js

# No VOLUME and no writable directory: every byte of state lives in Supabase,
# so the whole root filesystem can be mounted read-only (docker-compose.yml).

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.BENTO_PORT||3000)+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
