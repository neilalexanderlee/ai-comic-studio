import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterAssets } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { requireProjectOwner, requireCharacterInProject } from "@/lib/api-guard";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",         // mp3
  "audio/mp4",          // m4a / aac
  "audio/wav",          // wav
  "audio/x-wav",
  "audio/aiff",
  "audio/x-aiff",
  "audio/flac",
  "audio/ogg",
  "audio/webm",
]);

function tryDeleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* already gone */ }
}

/**
 * 解析操作目标资产：优先用 assetId 参数，否则取角色的默认定妆图，
 * 再否则取该角色第一个资产。
 * 这样 UI 可以在角色级别操作音频，无需关心具体哪张图。
 */
async function resolveTargetAsset(characterId: string, assetId: string | null) {
  if (assetId) {
    const [asset] = await db
      .select()
      .from(characterAssets)
      .where(eq(characterAssets.id, assetId))
      .limit(1);
    return asset ?? null;
  }

  // 优先默认资产
  const [defaultAsset] = await db
    .select()
    .from(characterAssets)
    .where(and(eq(characterAssets.characterId, characterId), eq(characterAssets.isDefault, 1)))
    .limit(1);
  if (defaultAsset) return defaultAsset;

  // 任意第一个
  const [first] = await db
    .select()
    .from(characterAssets)
    .where(eq(characterAssets.characterId, characterId))
    .limit(1);
  return first ?? null;
}

/**
 * POST /api/projects/:id/characters/:characterId/upload-audio
 * Query: assetId（可选，不传时自动绑定到默认定妆图）
 *
 * 为角色上传参考音频（角色级别）。
 * 音频用于 Seedance 多参模式音色克隆（@参考N 音频类型，情况2优先级）。
 * 支持格式：MP3 / WAV / M4A / FLAC / OGG / AIFF
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id: projectId, characterId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireCharacterInProject(characterId, projectId);
  if (!scope.ok) return scope.response;
  const { searchParams } = new URL(request.url);
  const assetId = searchParams.get("assetId");

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  if (!ALLOWED_AUDIO_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `不支持的音频格式：${file.type}，请上传 MP3 / WAV / M4A / FLAC` },
      { status: 400 }
    );
  }

  const target = await resolveTargetAsset(characterId, assetId);
  if (!target) {
    return NextResponse.json(
      { error: "该角色尚无定妆图，请先上传至少一张定妆图再设置音色参考" },
      { status: 400 }
    );
  }

  const oldAudioPath = target.audioPath;

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "mp3";
  const filename = `${ulid()}.${ext}`;
  const dir = path.join(uploadDir, "characters", "audio");
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  const [updated] = await db
    .update(characterAssets)
    .set({ audioPath: filepath })
    .where(eq(characterAssets.id, target.id))
    .returning();

  tryDeleteFile(oldAudioPath);

  return NextResponse.json(updated);
}

/**
 * DELETE /api/projects/:id/characters/:characterId/upload-audio
 * Query: assetId（可选）
 * 清除角色的参考音频
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id: projectId, characterId } = await params;
  const guard = await requireProjectOwner(request, projectId);
  if (!guard.ok) return guard.response;
  const scope = await requireCharacterInProject(characterId, projectId);
  if (!scope.ok) return scope.response;
  const { searchParams } = new URL(request.url);
  const assetId = searchParams.get("assetId");

  const target = await resolveTargetAsset(characterId, assetId);
  if (!target) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  tryDeleteFile(target.audioPath);

  const [updated] = await db
    .update(characterAssets)
    .set({ audioPath: null })
    .where(eq(characterAssets.id, target.id))
    .returning();

  return NextResponse.json(updated);
}
