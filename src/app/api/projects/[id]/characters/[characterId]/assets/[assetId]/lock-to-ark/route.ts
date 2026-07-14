import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { characterAssets, characters } from "@/lib/db/schema";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { resolveArkAssetLibraryClientCredentials } from "@/lib/ark-asset-library-credentials";
import { registerCharacterPortraitToArk } from "@/lib/ai/ark-asset-library";
import { uploadUrl } from "@/lib/utils/upload-url";

/**
 * 把一张角色定妆图注册进火山方舟「私域虚拟人像素材资产库」。
 *
 * 前提：
 * 1. 用户已在设置页配置好私域素材库 AK/SK 凭证（ark_asset_library_credentials 表）
 * 2. 已设置 AI_COMIC_APP_PUBLIC_URL 环境变量 —— 火山服务端需要一个公网可访问的 URL
 *    去抓取这张图，本地/内网地址（如 localhost）它抓不到。
 *
 * 注册是异步的（官方文档：单图处理约 13 秒），这里同步等待轮询结果后再返回，
 * 前端按钮进入 loading 态直到收到 active/failed。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string; assetId: string }> }
) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
  }

  const { characterId, assetId } = await params;

  const credentials = await resolveArkAssetLibraryClientCredentials(userId);
  if (!credentials) {
    return NextResponse.json(
      { error: "请先在设置页「私域虚拟人像素材资产库」配置 AK/SK 凭证" },
      { status: 400 }
    );
  }

  const publicBase = process.env.AI_COMIC_APP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!publicBase) {
    return NextResponse.json(
      {
        error:
          "未配置 AI_COMIC_APP_PUBLIC_URL 环境变量。火山服务端需要一个公网可访问的地址来抓取这张图片，" +
          "请将本应用部署到可公网访问的域名/反向代理后，在环境变量中设置 AI_COMIC_APP_PUBLIC_URL（如 https://your-domain.com），然后重启应用。",
      },
      { status: 400 }
    );
  }

  const [asset] = await db
    .select()
    .from(characterAssets)
    .where(eq(characterAssets.id, assetId));
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  if (!asset.imagePath) {
    return NextResponse.json({ error: "该形态还没有图片，无法锁定" }, { status: 400 });
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId));
  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const imageUrl = `${publicBase}${uploadUrl(asset.imagePath)}`;

  // 标记为 pending，前端可立即感知状态变化
  await db
    .update(characterAssets)
    .set({ arkAssetStatus: "pending" })
    .where(eq(characterAssets.id, assetId));

  try {
    const { groupId, assetId: arkAssetId, status } = await registerCharacterPortraitToArk({
      credentials,
      characterName: character.name,
      existingGroupId: character.arkAssetGroupId,
      imageUrl,
      label: asset.tag,
    });

    if (!character.arkAssetGroupId) {
      await db
        .update(characters)
        .set({ arkAssetGroupId: groupId })
        .where(eq(characters.id, characterId));
    }

    const finalStatus = status === "Active" ? "active" : "failed";
    await db
      .update(characterAssets)
      .set({
        arkAssetId,
        arkAssetStatus: finalStatus,
        arkAssetRegisteredAt: new Date(),
      })
      .where(eq(characterAssets.id, assetId));

    if (finalStatus === "failed") {
      return NextResponse.json(
        { error: "火山审核未通过（可能被判定为疑似真人/不符合虚拟人像要求），请更换图片后重试", status: finalStatus },
        { status: 422 }
      );
    }

    return NextResponse.json({ ok: true, groupId, assetId: arkAssetId, status: finalStatus });
  } catch (err) {
    await db
      .update(characterAssets)
      .set({ arkAssetStatus: "failed" })
      .where(eq(characterAssets.id, assetId));
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
