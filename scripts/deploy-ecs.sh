#!/usr/bin/env bash
#
# 部署到 ECS。用法：
#   ./scripts/deploy-ecs.sh                 # 增量部署（保留数据库）
#   ./scripts/deploy-ecs.sh --reset-db      # 清库重来（会删掉服务器上的数据库！）
#
# 为什么用 rsync 而不是在服务器上 git pull：
# 境内访问 GitHub 的 443 端口反复 TLS 中断（实测重试 5 次都没成）。
# 更要命的是失败方式——`git pull` 失败之后 `docker compose build` 照样成功，
# 于是容器起来了、跑的却是旧代码，从外面完全看不出来。
# rsync 走的是这条已经在用的 SSH 通道，不依赖任何第三方网络。
#
# 全脚本 `set -e`：**任何一步失败都立刻停**，绝不让后面的步骤在错误的前提上继续。

set -euo pipefail

HOST="${ECS_HOST:-root@<server-ip-redacted>}"
REMOTE_DIR="${ECS_DIR:-/opt/ai-comic-studio}"
RESET_DB=false
[[ "${1:-}" == "--reset-db" ]] && RESET_DB=true

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }

say "同步源码 → $HOST:$REMOTE_DIR"
# 刻意不同步 .env / data / uploads：密钥与数据只属于服务器那一侧。
# --delete 保证服务器上不会残留已经从仓库里删掉的文件。
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude data --exclude uploads --exclude .env \
  ./ "$HOST:$REMOTE_DIR/"

say "校验关键文件确实到位"
# 上次就是"前一步失败、后一步照常成功"吃了亏，这里显式确认一次
ssh "$HOST" "cd $REMOTE_DIR && test -f drizzle/baseline/schema.sql && test -f docker-compose.yml && test -f .env" \
  || { echo "服务器上缺关键文件，中止"; exit 1; }

if $RESET_DB; then
  say "⚠️  清空数据库（--reset-db）"
  ssh "$HOST" "cd $REMOTE_DIR && docker compose down >/dev/null 2>&1; rm -f data/aicomic.db*"
fi

say "构建镜像（境内镜像源从服务器 .env 读取）"
ssh "$HOST" "cd $REMOTE_DIR && docker compose build"

say "启动容器"
ssh "$HOST" "cd $REMOTE_DIR && docker compose up -d"

say "等待就绪并验证"
ssh "$HOST" "cd $REMOTE_DIR && sleep 20 && docker compose ps --format '{{.Service}}  {{.State}}'"

# 只要有一个容器不是 running 就算失败 —— 别让"部署成功"的假象过去
ssh "$HOST" "cd $REMOTE_DIR && test \$(docker compose ps --format '{{.State}}' | grep -c '^running$') -eq 2" \
  || { echo "有容器未处于 running，看日志：ssh $HOST 'cd $REMOTE_DIR && docker compose logs --tail 50'"; exit 1; }

ssh "$HOST" "curl -sf -o /dev/null http://localhost:3007/" \
  || { echo "应用未响应 HTTP"; exit 1; }

say "部署完成"
cat <<EOF
访问：
  ssh -L 3007:localhost:3007 ${HOST}
  然后打开 http://localhost:3007
EOF
