FROM node:22-alpine AS base

# If apk fetch fails (e.g. exit 46) due to slow/unstable link to dl-cdn, build with:
#   docker compose build --build-arg ALPINE_MIRROR=https://mirrors.aliyun.com
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org
RUN sed -i "s#https://dl-cdn.alpinelinux.org#${ALPINE_MIRROR}#g" /etc/apk/repositories

# Install pnpm —— **必须锁版本**。
# 原先写的是 pnpm@latest：pnpm 10.33 起依赖 node:sqlite（Node 22.5+ 才有的内置模块），
# 于是 base 还停在 node:20 时，某天 pnpm 发新版，构建就毫无预兆地断在
# `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`——而代码一行没改。
# 版本跟着 package.json 的 packageManager 走，两处要一起改。
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Install ffmpeg with libass for subtitle burn-in, and fonts for CJK subtitles
RUN apk add --no-cache ffmpeg font-noto-cjk

# --- Dependencies ---
FROM base AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app

# 依赖下载镜像。默认走官方源 —— 境外构建不受影响；
# 中国内地构建务必传镜像，否则 npm 直连只有几十 KiB/s：
#   docker compose build \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg BETTER_SQLITE3_BINARY_HOST=https://cdn.npmmirror.com/binaries/better-sqlite3
#
# better-sqlite3 单独列出来，是因为它的预编译包托管在 GitHub Releases 而不是 npm，
# registry 镜像救不了它。下载超时后会回落到 node-gyp 从源码编译，
# 而 node-gyp 又要去 unofficial-builds.nodejs.org 拉 musl 版头文件 —— 同样拉不动。
# 于是失败点看起来像"编译环境有问题"，实际只是网络。
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG BETTER_SQLITE3_BINARY_HOST=
ENV npm_config_better_sqlite3_binary_host=$BETTER_SQLITE3_BINARY_HOST

COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry "$NPM_REGISTRY" \
 && pnpm install --frozen-lockfile

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
