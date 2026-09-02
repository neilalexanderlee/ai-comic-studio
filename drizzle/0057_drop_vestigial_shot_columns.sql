-- Migration 0057: 真正删掉 shots 表的 emotion / framing / lighting_atm 三列
--
-- 背景：migration 0042/0043 本想删这三列，用的是「建新表→拷数据→删旧表→改名」模式
-- （当年假设 SQLite < 3.35 不支持 DROP COLUMN）。那两份迁移执行到一半失败、
-- 又被误记为已应用，于是三列一直留在库里，而 schema.ts 和全部代码路径早已不再声明它们。
-- 详见 CLAUDE.md 已知陷阱表「migration 0042/0043 被记为已应用但从未生效」。
--
-- 现在 better-sqlite3 内置 SQLite 3.51，原生支持 ALTER TABLE DROP COLUMN，
-- 不必再走重建表那套高风险流程。配合迁移执行器的事务包裹，三条要么全成、要么全滚。
--
-- 数据影响：这三列在 38 行里只有 3 行有非空的 emotion/framing 遗留值，
-- 且所有代码路径都不读不写它们（信息早已统一写入 startFrameDesc，见约定 14）。
ALTER TABLE shots DROP COLUMN emotion;
--> statement-breakpoint
ALTER TABLE shots DROP COLUMN framing;
--> statement-breakpoint
ALTER TABLE shots DROP COLUMN lighting_atm;
