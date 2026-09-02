import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { characters, characterAssets } from "@/lib/db/schema";
import { deleteArtifact } from "@/lib/storage/artifact-store";

/**
 * 显式级联删除 —— 补 `character_assets` 缺失的外键约束。
 *
 * ## 为什么需要
 *
 * `schema.ts` 里写了：
 * ```ts
 * characterId: text("character_id").notNull()
 *   .references(() => characters.id, { onDelete: "cascade" })
 * ```
 * 但**实际建表 SQL 从未包含这个外键**（`character_id TEXT NOT NULL`，没有 REFERENCES）。
 * Drizzle 的 `.references()` 只影响它自己生成迁移文件时的输出；本项目的迁移是手写 SQL，
 * 这个约束从来没进过数据库。
 *
 * 后果是真实发生过的：删掉一个项目后，characters 行随 projects 级联删除，
 * 但 character_assets 行留了下来，而文件已被删除处理器清掉 ——
 * 库里积了 249 条指向不存在文件的死记录（已用 scripts/prune-orphan-assets.ts 清理）。
 *
 * ## 为什么不直接补外键
 *
 * SQLite 不支持 `ALTER TABLE ADD CONSTRAINT`，补外键必须重建表
 * （建新表 → 拷数据 → 删旧表 → 改名）。那是对存量数据的高风险操作，
 * 值不值得单独评估。在此之前，用应用层显式删除堵住这个洞。
 *
 * **删除角色一律走这里，不要直接 `db.delete(characters)`。**
 */

/** 删除若干角色，并显式清理其 character_assets 行与对应的产物文件。 */
export async function deleteCharactersCascade(characterIds: string[]): Promise<void> {
  if (characterIds.length === 0) return;

  const assets = await db
    .select({
      id: characterAssets.id,
      imagePath: characterAssets.imagePath,
      audioPath: characterAssets.audioPath,
    })
    .from(characterAssets)
    .where(inArray(characterAssets.characterId, characterIds));

  // 先删库、后删文件：反过来的话，删文件成功但删库失败会留下悬空引用
  await db.delete(characterAssets).where(inArray(characterAssets.characterId, characterIds));
  await db.delete(characters).where(inArray(characters.id, characterIds));

  for (const a of assets) {
    await deleteArtifact(a.imagePath);
    await deleteArtifact(a.audioPath);
  }
}

/** 单个角色的便捷封装 */
export async function deleteCharacterCascade(characterId: string): Promise<void> {
  return deleteCharactersCascade([characterId]);
}

/** 删除某项目下全部角色及其资产（供项目删除路径调用） */
export async function deleteProjectCharactersCascade(projectId: string): Promise<void> {
  const rows = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.projectId, projectId));
  await deleteCharactersCascade(rows.map((r) => r.id));
}
