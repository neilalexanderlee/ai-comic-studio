#!/usr/bin/env bash
#
# 输出数据库的内容指纹：每张业务表一行 `<表名> <CRC>-<字节数>`。
#
#   ./scripts/db-fingerprint.sh data/aicomic.db
#
# ## 三个设计约束，每一条都是被具体问题逼出来的
#
# 1. **必须与 sqlite3 版本无关**。本地是 3.50，服务器是 3.37 —— 拿 `.dump` 的文本去比
#    随时可能因为格式差异而恒报「不一致」。所以这里比的是 `SELECT *` 的行数据本身；
#    本库所有列都是 TEXT/INTEGER（无浮点、无 BLOB），跨版本序列化是稳定的。
#
# 2. **必须与哈希工具无关**。macOS 有 `shasum`、Linux 有 `sha256sum`，输出不通用。
#    用 POSIX `cksum`：两边都有、算法由标准规定，结果可直接对比。
#    CRC-32 对「检测有没有变」足够；这不是防篡改用途。
#
# 3. **输出必须小**。整库文本有好几 MB，每次启动 dev 都传一遍就等于把库拷一遍。
#    按表算完 CRC 再传，25 行、几百字节。
#    附带好处：能直接说出**哪张表**不一样，而不只是「不一样」。
#
# 内部表（`__drizzle_migrations` / `__migration_lock` / `sqlite_*`）一律跳过 ——
# 它们是各自的运行时状态，两端天然不同（服务器跑过迁移锁、本地没跑过），
# 算进去会永远误报。
set -euo pipefail

DB="${1:?用法: db-fingerprint.sh <db 文件路径>}"
if [[ ! -f "$DB" ]]; then echo "MISSING"; exit 0; fi

TABLES=$(sqlite3 "$DB" "
  SELECT name FROM sqlite_master
  WHERE type='table'
    AND name NOT LIKE '\_\_%' ESCAPE '\'
    AND name NOT LIKE 'sqlite\_%' ESCAPE '\'
  ORDER BY name;")

for t in $TABLES; do
  # 按全部列排序，保证行序与 rowid 无关 —— 否则两份内容相同但插入顺序不同的库会被判成不同
  order=$(sqlite3 "$DB" "SELECT group_concat(n) FROM (SELECT cid+1 AS n FROM pragma_table_info('$t') ORDER BY cid);")
  sum=$(sqlite3 -noheader -list -separator '|' -nullvalue '<NULL>' "$DB" \
          "SELECT * FROM \"$t\" ORDER BY $order;" | cksum | awk '{print $1"-"$2}')
  echo "$t $sum"
done
