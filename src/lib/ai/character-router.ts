import { db } from "@/lib/db";
import { characterAssets } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import fs from "node:fs";

export type CharacterAssets = {
  id: string;
  name: string;
};

/**
 * Resolves the most appropriate reference image for each character in a scene.
 * Selection logic: isDefault=1 asset first, fallback to first morph, then blueprint.
 * Also returns angle variant images (3q / profile / back) and audio path.
 */
export type AngleImage = {
  angle: string;
  path: string;
  /** 若该角度变体也已注册进私域素材库且状态为 active，视频生成时应优先用 asset:// 引用 */
  arkAssetId?: string | null;
  arkAssetStatus?: "none" | "pending" | "active" | "failed" | null;
};

export type ResolvedCharacterImage = {
  name: string;
  imagePath: string;
  /** 角度变体图（3q / profile / back），与主图同一服装状态，文件已确认存在 */
  angleImages: AngleImage[];
  audioPath?: string | null;
  /**
   * 若主图已注册进火山方舟私域虚拟人像素材资产库且状态为 active，这里是该素材的永久 ID
   * （不含 asset:// 前缀）。视频生成时应优先用 `asset://<arkAssetId>` 替代 imagePath，
   * 绕过 Seedance 2.0 真人人脸拦截，且与分镜静图用的是同一张脸。
   */
  arkAssetId?: string | null;
  arkAssetStatus?: "none" | "pending" | "active" | "failed" | null;
};

export async function resolveCharacterImages(
  _sceneDesc: string,
  characters: CharacterAssets[],
): Promise<ResolvedCharacterImage[]> {
  const resolved: ResolvedCharacterImage[] = [];

  for (const c of characters) {
    // 1. Fetch all morph assets for this character
    const assets = await db.select()
        .from(characterAssets)
        .where(and(
            eq(characterAssets.characterId, c.id),
            eq(characterAssets.assetType, "morph")
        ));

    // Primary assets only (angle = null, i.e., original user-uploaded images)
    const primaryAssets = assets.filter(a => a.angle === null || a.angle === undefined);
    // Angle variant assets (3q / profile / back)
    const angleAssets = assets.filter(a => a.angle !== null && a.angle !== undefined);

    const blueprintAssets = await db.select()
        .from(characterAssets)
        .where(and(
            eq(characterAssets.characterId, c.id),
            eq(characterAssets.assetType, "blueprint")
        ));

    let finalPath: string | null = null;
    let selectedTag: string | null = null;
    let selectedArkAssetId: string | null = null;
    let selectedArkAssetStatus: "none" | "pending" | "active" | "failed" | null = null;

    if (primaryAssets.length > 1) {
      // Multiple morph assets → prefer isDefault=1, fallback to first
      const defaultAsset = primaryAssets.find(a => a.isDefault === 1) ?? primaryAssets[0];
      finalPath = defaultAsset.imagePath;
      selectedTag = defaultAsset.tag;
      selectedArkAssetId = defaultAsset.arkAssetId ?? null;
      selectedArkAssetStatus = defaultAsset.arkAssetStatus ?? null;
    } else if (primaryAssets.length === 1) {
      // Single morph → use it directly
      finalPath = primaryAssets[0].imagePath;
      selectedTag = primaryAssets[0].tag;
      selectedArkAssetId = primaryAssets[0].arkAssetId ?? null;
      selectedArkAssetStatus = primaryAssets[0].arkAssetStatus ?? null;
    } else {
      // No morphs → fall back to blueprint
      finalPath = blueprintAssets[0]?.imagePath || null;
    }

    if (finalPath) {
      // 收集选定服装状态的角度变体图（file 存在才收录），按 3q → profile → back 顺序
      const ANGLE_ORDER = ["3q", "profile", "back"];
      const angleImages: AngleImage[] = [];
      for (const angle of ANGLE_ORDER) {
        const av = angleAssets.find(a => a.tag === selectedTag && a.angle === angle && a.imagePath && fs.existsSync(a.imagePath));
        if (av?.imagePath) {
          angleImages.push({
            angle,
            path: av.imagePath,
            arkAssetId: av.arkAssetId ?? null,
            arkAssetStatus: av.arkAssetStatus ?? null,
          });
        }
      }

      // 查询角色的音色参考路径（任意 assetType 中第一个非空 audioPath）
      const audioAssets = await db
        .select({ audioPath: characterAssets.audioPath })
        .from(characterAssets)
        .where(eq(characterAssets.characterId, c.id));
      const audioPath = audioAssets.find((a) => !!a.audioPath)?.audioPath ?? null;

      console.log(`[CharacterRouter] "${c.name}" → tag="${selectedTag}" isDefault path="${finalPath}"${angleImages.length ? ` +${angleImages.length}角度变体` : ""}${selectedArkAssetStatus === "active" ? " [已锁定私域素材库]" : ""}`);
      resolved.push({
        name: c.name,
        imagePath: finalPath,
        angleImages,
        audioPath,
        arkAssetId: selectedArkAssetId,
        arkAssetStatus: selectedArkAssetStatus,
      });
    }
  }

  return resolved;
}
