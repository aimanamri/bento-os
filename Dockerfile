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
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# --omit=optional drops better-sqlite3: it only backs the local-SQLite variant
# and the migrate-sqlite-to-supabase script, neither of which runs in here.
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# ---- build: compile assets ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# The PWA assets come from the build context (src/assets, src/manifest.…) and
# from build:sw, so a .dockerignore change or a missing file degrades the app
# silently: it still boots, it just stops being installable or offline-capable.
# Fail the image build instead.
# The last two assertions guard the obfuscation step (scripts/build-js.js):
# the image must ship exactly one bundle and none of the readable modules it
# was built from, or a build regression quietly republishes the source.
RUN npm run build \
 && test -s dist/sw.js \
 && test -s dist/manifest.webmanifest \
 && test -s dist/assets/icons/icon-512.png \
 && test -s dist/assets/icons/icon-maskable-512.png \
 && test -s dist/js/app.js \
 && test "$(ls dist/js | wc -l)" -eq 1

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

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

# No VOLUME and no writable directory: every byte of state lives in Supabase,
# so the whole root filesystem can be mounted read-only (docker-compose.yml).

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.BENTO_PORT||3000)+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
