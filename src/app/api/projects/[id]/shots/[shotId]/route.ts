import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, dialogues, characters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { normalizeCharacterName } from "@/lib/storyboard/normalize-character-name";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  const body = (await request.json()) as Partial<{
    prompt: string;
    duration: number;
    sequence: number;
    startFrameDesc: string | null;
    endFrameDesc: string | null;
    motionScript: string | null;
    cameraDirection: string;
    firstFrame: string | null;
    lastFrame: string | null;
    sceneRefFrame: string | null;
    videoPrompt: string | null;
    /** 台词更新：传入完整列表，后端全量替换 */
    dialogues: Array<{
      /** 已有台词的 id（传则更新 text），不传则视为新增 */
      id?: string;
      /** 新增时必须提供角色名（按名称匹配项目角色） */
      characterName?: string;
      text: string;
    }>;
  }>;

  // ── 台词更新（与 shot 字段更新解耦） ─────────────────────────────────────
  if (body.dialogues !== undefined) {
    const incoming = body.dialogues;

    // 查出本镜现有台词，用于 id 校验
    const existing = await db
      .select({ id: dialogues.id, characterId: dialogues.characterId })
      .from(dialogues)
      .where(eq(dialogues.shotId, shotId));
    const existingById = new Map(existing.map((d) => [d.id, d]));

    // 查出项目所有角色，用于名称匹配
    const projectChars = await db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(eq(characters.projectId, projectId));
    const charByNorm = new Map(
      projectChars.map((c) => [normalizeCharacterName(c.name), c])
    );

    // 全量替换：先删再插（简单可靠）
    await db.delete(dialogues).where(eq(dialogues.shotId, shotId));

    const toInsert: (typeof dialogues.$inferInsert)[] = [];
    for (let i = 0; i < incoming.length; i++) {
      const d = incoming[i];
      if (!d.text?.trim()) continue;

      let charId: string | null = null;

      // Prefer explicit characterName (user may have changed the speaker on an existing line).
      if (d.characterName?.trim()) {
        const matched = charByNorm.get(normalizeCharacterName(d.characterName));
        if (matched) charId = matched.id;
      }
      // Fall back to existing characterId when name is absent or unmatched
      if (!charId && d.id && existingById.has(d.id)) {
        charId = existingById.get(d.id)!.characterId;
      }

      if (!charId) continue; // 找不到对应角色则跳过

      toInsert.push({
        id: ulid(),
        shotId,
        characterId: charId,
        text: d.text.trim(),
        sequence: i,
      });
    }

    if (toInsert.length > 0) {
      await db.insert(dialogues).values(toInsert);
    }
  }

  // ── Shot 字段更新 ─────────────────────────────────────────────────────────
  const { dialogues: _d, ...shotFields } = body;
  if (Object.keys(shotFields).length > 0) {
    const [updated] = await db
      .update(shots)
      .set(shotFields)
      .where(eq(shots.id, shotId))
      .returning();
    return NextResponse.json(updated);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { shotId } = await params;
  await db.delete(shots).where(eq(shots.id, shotId));
  return new NextResponse(null, { status: 204 });
}
