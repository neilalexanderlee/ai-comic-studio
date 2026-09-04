FROM node:20-alpine AS base

# If apk fetch fails (e.g. exit 46) due to slow/unstable link to dl-cdn, build with:
#   docker compose build --build-arg ALPINE_MIRROR=https://mirrors.aliyun.com
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org
RUN sed -i "s#https://dl-cdn.alpinelinux.org#${ALPINE_MIRROR}#g" /etc/apk/repositories

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install ffmpeg with libass for subtitle burn-in, and fonts for CJK subtitles
RUN apk add --no-cache ffmpeg font-noto-cjk

# --- Dependencies ---
FROM base AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM deps AS builder
COPY . .
RUN pnpm build

# --- Production ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3007
ENV PORT=3007
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/data/aicomic.db"
ENV UPLOAD_DIR="/app/uploads"

CMD ["node", "server.js"]

# --- Worker（独立的渲染进程）---
#
# 刻意基于 deps 而不是 standalone 产物：standalone 只含 Next 编译后的服务端代码，
# 没有 src/ 也没有 tsx，跑不了 scripts/worker.ts。把 worker 单独 bundle 一份要处理
# better-sqlite3 / ali-oss 这些原生与动态依赖，代价远大于多占一点磁盘。
#
# 它必须与 web 共享 /app/data 与 /app/uploads —— SQLite 的 WAL 支持同机多进程，
# 但不支持跨网络文件系统。要把 worker 挪到另一台机器，得先迁到 PostgreSQL。
FROM deps AS worker
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/data/aicomic.db"
ENV UPLOAD_DIR="/app/uploads"
CMD ["pnpm", "worker"]
