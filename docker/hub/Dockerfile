# SyncGuard Hub — production image (Coolify / Docker)

FROM node:22-bookworm-slim AS web-build
WORKDIR /build/hub/web
COPY hub/web/package.json hub/web/package-lock.json ./
RUN npm ci
COPY hub/web/ ./
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Install MinIO Client (mc)
RUN curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc \
  && mc --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY hub ./hub
COPY --from=web-build /build/hub/public ./hub/public

ENV NODE_ENV=production
ENV HUB_DATA_DIR=/data
ENV HUB_PORT=7443
ENV PORT=7443

RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 7443

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-7443}/api/v1/health" || exit 1

VOLUME ["/data"]

CMD ["node", "hub/server.js"]
