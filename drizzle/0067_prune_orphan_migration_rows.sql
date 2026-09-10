-- 清理 __drizzle_migrations 里三条对不上任何迁移文件的孤儿记录。
--
-- 它们是惰性的：执行器按「文件内容的 SHA-256 是否出现在表里」逐条判断
-- （src/lib/db/index.ts 的 applied.has(hash)），多余的行从不会被读到。
-- 但它们让「已应用条数」永远比 journal 多 3，每次核对迁移状态都要重新解释一遍，
-- 已经误导过一次排查。
--
-- 来历（用 git 全历史反查每个 .sql 的历史版本 hash 得到）：
--   5621e34a… 曾是 0028_add_style_reference_image.sql，该文件后来被编辑过，hash 变了
--   ee0469e5… / 896066bf… 在 git 全历史里找不到对应文件 —— 属于早期用
--                          `drizzle-kit push` 直接改库的那段时期（见 CLAUDE.md 约定 8l）
--
-- 按 hash 精确删除，不按 id：这张表建表语句用的是 PostgreSQL 的 `id SERIAL PRIMARY KEY`，
-- 在 SQLite 下 SERIAL 不是 INTEGER PRIMARY KEY 的别名，所以 id 列**全是 NULL**，
-- 拿它定位会一条都删不掉（或误删）。
--
-- 对没有这些残留的库（全新安装、以及大多数自部署用户）这是空操作。
DELETE FROM __drizzle_migrations WHERE hash = '5621e34abfde6b3ba24bb8fd1216d5270d14554f964f27bbb670e01b8262c8de';
--> statement-breakpoint
DELETE FROM __drizzle_migrations WHERE hash = 'ee0469e5e8d4a480e6c0426160a1a9a55de1b56da13e9c54941127952a541c05';
--> statement-breakpoint
DELETE FROM __drizzle_migrations WHERE hash = '896066bfe6bfb46813510f2d7421ffe2e87ef2bdd80367c88a24d17dd732d657';
