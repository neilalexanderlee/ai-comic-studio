#!/usr/bin/env bash
#
# `pnpm dev` 启动前的数据库检查。**永远不阻塞 dev，永远 exit 0。**
#
# ## 为什么默认只提示、不覆盖
#
# `db-sync.sh pull` 是**整库覆盖本地**。如果每次启动 dev 都自动跑一遍，
# 你在 localhost 上随手建的项目、改的分镜，下次重启就没了，而且没有任何提示 ——
# Turbopack 重启很频繁，这个坑迟早会踩到。所以默认只把「本地落后了」这件事说出来，
# 拉不拉由你决定。
#
# ## 想要全自动：DB_AUTO_PULL=1
#
# 开了也仍然有一道闸：**只在本地自上次同步以来没被改过时才自动拉**。
# 判断依据是 data/.db-sync.json 里记的上次同步时的指纹。本地有改动就拒绝自动执行，
# 明确告诉你有哪些表变了 —— 要丢弃得你自己手动跑。
#
# ## 环境变量
#   DB_AUTO_PULL=1     本地没改动时自动拉取（默认关）
#   DB_SYNC_DISABLE=1  整个检查跳过（离线工作、或临时不想连服务器时）
#   ECS_HOST           默认 root@<server-ip-redacted>

set -uo pipefail   # 故意不要 -e：任何一步失败都只该降级成「跳过检查」，不该拦住 dev

DIM=$'\033[2m'; YEL=$'\033[1;33m'; CYA=$'\033[1;36m'; RST=$'\033[0m'

[[ "${DB_SYNC_DISABLE:-}" == "1" ]] && exit 0

HOST="${ECS_HOST:-root@<server-ip-redacted>}"
REMOTE_DIR="${ECS_DIR:-/opt/ai-comic-studio}"
LOCAL_DB="${DATABASE_URL:-./data/aicomic.db}"; LOCAL_DB="${LOCAL_DB#file:}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER="$(dirname "$LOCAL_DB")/.db-sync.json"

command -v sqlite3 >/dev/null 2>&1 || { echo "${DIM}跳过数据库检查：本机没有 sqlite3${RST}"; exit 0; }
[[ -f "$LOCAL_DB" ]] || { echo "${DIM}跳过数据库检查：本地还没有数据库${RST}"; exit 0; }

LOCAL_FP="$("$HERE/db-fingerprint.sh" "$LOCAL_DB" 2>/dev/null)"
REMOTE_FP="$(ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new \
              "$HOST" "bash -s -- $REMOTE_DIR/data/aicomic.db" < "$HERE/db-fingerprint.sh" 2>/dev/null)"

if [[ -z "$REMOTE_FP" || "$REMOTE_FP" == "MISSING" ]]; then
  echo "${DIM}跳过数据库检查：连不上服务器（离线 / 服务器关机都会这样，不影响本地开发）${RST}"
  exit 0
fi

if [[ "$LOCAL_FP" == "$REMOTE_FP" ]]; then
  echo "${DIM}数据库与服务器一致${RST}"
  exit 0
fi

DIFF_TABLES=$(diff <(echo "$LOCAL_FP") <(echo "$REMOTE_FP") | awk '/^[<>]/ {print $2}' | sort -u | tr '\n' ' ')

# 本地自上次同步以来动过吗？没有记录就当作「不知道」，保守处理：不自动拉
LOCAL_SUM=$(echo "$LOCAL_FP" | cksum | awk '{print $1"-"$2}')
RECORDED=$(sed -n 's/.*"fingerprint"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MARKER" 2>/dev/null)
if [[ -n "$RECORDED" && "$RECORDED" == "$LOCAL_SUM" ]]; then LOCAL_DIRTY=0; else LOCAL_DIRTY=1; fi

echo
echo "${YEL}▸ 本地数据库与服务器不一致${RST}"
echo "  不同的表：${DIFF_TABLES}"

if [[ "${DB_AUTO_PULL:-}" == "1" && "$LOCAL_DIRTY" == "0" ]]; then
  echo "  ${CYA}本地自上次同步后没有改动，自动拉取服务器数据…${RST}"
  bash "$HERE/db-sync.sh" pull --yes && exit 0
  echo "  ${YEL}自动拉取失败，本地库未被改动。手动重试：pnpm db:pull${RST}"
  exit 0
fi

if [[ "${DB_AUTO_PULL:-}" == "1" ]]; then
  if [[ -z "$RECORDED" ]]; then
    echo "  ${YEL}没有同步记录，不敢自动覆盖${RST} —— 手动跑一次 ${CYA}pnpm db:pull${RST} 之后就会自动了"
  else
    echo "  ${YEL}本地有改动，不自动覆盖${RST} —— 确认可以丢弃后跑 ${CYA}pnpm db:pull${RST}"
  fi
else
  echo "  服务器是权威副本（docs/DEPLOYMENT.md 第二节）。要同步到本地："
  echo "    ${CYA}pnpm db:pull${RST}"
fi
echo "${DIM}  （dev 照常启动，本地库不会被自动改动）${RST}"
echo
exit 0
