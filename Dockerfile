# syntax=docker/dockerfile:1
#
# Bento OS — production image (multi-stage)
#   deps    → production-only node_modules (express + better-sqlite3)
#   build   → full deps, compiles CSS + copies static/vendor assets into dist/
#   runtime → minimal, non-root, read-only-friendly; ships dist/ + server/ only
#
# The client libs (mermaid, katex, markdown-it, dompurify) are build-time-only:
# they are baked into dist/vendor and served statically, so the Node process
# never require()s them and they must NOT end up in the runtime node_modules.

# ---- deps: resolve production dependencies once ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# better-sqlite3 pulls a prebuilt musl binary here (no compiler needed).
RUN npm ci --omit=dev && npm cache clean --force

# ---- build: compile assets ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini = PID 1: forwards SIGTERM to Node (for graceful WAL checkpoint) and reaps
# zombies. Non-root user is created up front.
RUN apk add --no-cache tini \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001

# Only the two things the server actually loads at runtime, plus built assets.
COPY --from=deps  --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist    ./dist
COPY --from=build --chown=nodejs:nodejs /app/server  ./server
COPY --chown=nodejs:nodejs package*.json ./

# Writable data dir owned by the app user — works even with no volume mounted
# and lets the root filesystem be mounted read-only (see docker-compose.yml).
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data
VOLUME ["/app/data"]

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.BENTO_PORT||3000)+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
