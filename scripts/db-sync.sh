#!/usr/bin/env bash
#
# 在本地与服务器之间**单向**同步数据库。
#
#   ./scripts/db-sync.sh pull            # 服务器 → 本地（常规操作）
#   ./scripts/db-sync.sh push            # 本地 → 服务器（破坏性，见下）
#   ./scripts/db-sync.sh pull --yes      # 跳过确认（给 db-dev-sync.sh 的自动拉取用）
#
# ## 方向已经定了：**以服务器为准**
#
# 本地和服务器各有一份 SQLite，两边都能写，**一旦都用就必然分叉**：
# 服务器上新建的分镜本地看不到，反之亦然。SQLite 没有多主同步这回事，
# 唯一干净的做法是**认定一边为准**，另一边只做整体覆盖。
#
# 本项目认定**服务器那份是权威副本**（服务器读写 OSS 走内网、不吃 2GB/月的下行流量包，
# 而且 worker 就在那边）。所以：
#   · `pull` 是常规操作 —— 把权威数据取到本地开发用
#   · `push` 是**破坏性**的 —— 会丢掉服务器上自上次同步以来的一切，只在明确要放弃它时用
# 详见 docs/DEPLOYMENT.md 第二节。
#
# 而"整体覆盖"最容易出的事故是覆盖错方向 —— 拿旧的盖掉新的，且当场看不出来。
# 所以这个脚本做三件事：
#   1. 覆盖前把目标端备份到 data/_bak/（带时间戳，不删）
#   2. 先打印两边的项目/剧集/分镜条数，让方向错误在按回车之前就暴露
#   3. 必须手动确认
#
# ## OSS 是共用的
#
# 两边写进同一个 bucket，所以素材本身不会丢。分叉的是**引用素材的那些数据库行**。
# 被放弃的那一边生成过的对象会变成没人引用的孤儿（照常计费），
# 用 `pnpm assets:prune` 清理。

set -euo pipefail

HOST="${ECS_HOST:-root@<server-ip-redacted>}"
REMOTE_DIR="${ECS_DIR:-/opt/ai-comic-studio}"
LOCAL_DB="${DATABASE_URL:-./data/aicomic.db}"
LOCAL_DB="${LOCAL_DB#file:}"
REMOTE_DB="$REMOTE_DIR/data/aicomic.db"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKER="$(dirname "$LOCAL_DB")/.db-sync.json"
DIR="${1:-}"
ASSUME_YES=0
for a in "$@"; do [[ "$a" == "--yes" ]] && ASSUME_YES=1; done

# 记下「本次同步完成时本地库长什么样」。db-dev-sync.sh 靠它判断
# 本地自上次同步以来有没有被改过 —— 有改动就不允许自动覆盖。
write_marker() {
  local sum
  sum=$("$HERE/db-fingerprint.sh" "$LOCAL_DB" | cksum | awk '{print $1"-"$2}')
  printf '{\n  "fingerprint": "%s",\n  "direction": "%s",\n  "host": "%s",\n  "at": "%s"\n}\n' \
    "$sum" "$1" "$HOST" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

counts_local() {
  sqlite3 "$1" "SELECT (SELECT COUNT(*) FROM projects)||' 项目 / '||(SELECT COUNT(*) FROM episodes)||' 剧集 / '||(SELECT COUNT(*) FROM shots)||' 分镜';" 2>/dev/null || echo "(读不出)"
}

case "$DIR" in
  pull)
    echo "▸ 从服务器取一致性快照"
    # 必须用 .backup 而不是直接拷文件：直接拷会漏掉 WAL 里尚未合并的数据
    ssh "$HOST" "cd $REMOTE_DIR && sqlite3 data/aicomic.db \".backup '/tmp/sync.db'\""
    scp -q "$HOST:/tmp/sync.db" "$TMP/incoming.db"
    ssh "$HOST" "rm -f /tmp/sync.db"
    SRC_DESC="服务器"; DST_DESC="本地"; DST="$LOCAL_DB"
    ;;
  push)
    echo "▸ 从本地取一致性快照"
    sqlite3 "$LOCAL_DB" ".backup '$TMP/incoming.db'"
    SRC_DESC="本地"; DST_DESC="服务器"; DST="$REMOTE_DB"
    ;;
  *)
    echo "用法: $0 pull|push"; exit 1;;
esac

echo
echo "  来源（$SRC_DESC）: $(counts_local "$TMP/incoming.db")"
if [[ "$DIR" == "pull" ]]; then
  echo "  目标（$DST_DESC）: $(counts_local "$LOCAL_DB")"
else
  ssh "$HOST" "cd $REMOTE_DIR && sqlite3 data/aicomic.db \"SELECT (SELECT COUNT(*) FROM projects)||' 项目 / '||(SELECT COUNT(*) FROM episodes)||' 剧集 / '||(SELECT COUNT(*) FROM shots)||' 分镜';\"" | sed 's/^/  目标（服务器）: /'
fi
echo
if [[ "$ASSUME_YES" == "1" ]]; then
  echo "用「$SRC_DESC」整体覆盖「$DST_DESC」（--yes，已跳过确认；目标仍会先备份）"
else
  read -r -p "用「$SRC_DESC」整体覆盖「$DST_DESC」？目标会先备份。(yes/N) " ans
  [[ "$ans" == "yes" ]] || { echo "已取消"; exit 0; }
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
if [[ "$DIR" == "pull" ]]; then
  mkdir -p ./data/_bak
  [[ -f "$LOCAL_DB" ]] && sqlite3 "$LOCAL_DB" ".backup './data/_bak/local-$STAMP.db'"
  # -shm/-wal 属于旧库，留着会让 SQLite 拿新库配旧 WAL
  rm -f "$LOCAL_DB-shm" "$LOCAL_DB-wal"
  cp "$TMP/incoming.db" "$LOCAL_DB"
  write_marker pull
  echo "▸ 完成。原本地库备份在 data/_bak/local-$STAMP.db"
else
  ssh "$HOST" "cd $REMOTE_DIR && mkdir -p data/_bak && docker compose down >/dev/null 2>&1 && sqlite3 data/aicomic.db \".backup 'data/_bak/server-$STAMP.db'\" && rm -f data/aicomic.db-shm data/aicomic.db-wal"
  scp -q "$TMP/incoming.db" "$HOST:$REMOTE_DB"
  ssh "$HOST" "cd $REMOTE_DIR && chmod 600 data/aicomic.db && docker compose up -d >/dev/null 2>&1"
  # push 之后两端相同，本地同样处于「已同步」状态
  write_marker push
  echo "▸ 完成。原服务器库备份在 $REMOTE_DIR/data/_bak/server-$STAMP.db"
fi
