import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, characters, episodeCharacters } from "@/lib/db/schema";
import { eq, and, max } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";

export const maxDuration = 60;

interface EpisodeData {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  script?: string;
  characters?: string[];
}

interface CharacterData {
  name: string;
  scope: "main" | "guest";
  description: string;
  visualHint?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    episodes: EpisodeData[];
    characters: CharacterData[];
  };

  await addImportLog(
    projectId, 4, "running",
    `开始创建 ${body.episodes.length} 集和 ${body.characters.length} 个角色`
  );

  // 1. Create all characters (main + guest), build name→id map
  const charIdByName = new Map<string, string>();
  for (const char of body.characters) {
    const charId = ulid();
    await db.insert(characters).values({
      id: charId,
      projectId,
      name: char.name,
      description: char.description,
      visualHint: char.visualHint ?? "",
      scope: char.scope,
      episodeId: null, // all characters are project-level now
    });
    charIdByName.set(char.name.toLowerCase().trim(), charId);
  }

  await addImportLog(
    projectId, 4, "running",
    `已创建 ${body.characters.length} 个角色`
  );

  // 2. Create episodes
  const [seqResult] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, projectId));

  let seq = (seqResult?.maxSeq ?? 0) + 1;

  const created = [];
  for (const ep of body.episodes) {
    const [row] = await db
      .insert(episodes)
      .values({
        id: ulid(),
        projectId,
        title: ep.title,
        description: ep.description || "",
        keywords: ep.keywords || "",
        idea: ep.idea || "",
        script: ep.script || ep.idea || "",
        sequence: seq++,
      })
      .returning();
    created.push(row);
  }

  // 3. Create episode_characters relations
  // If the split path provided explicit character lists, use them.
  // Otherwise (structural heading split always returns []), fall back to
  // text-matching: any character name that appears in the episode script
  // gets linked, so dialogue matching works correctly later.
  let relationCount = 0;
  const allCharNames = [...charIdByName.keys()]; // lowercase trimmed names

  for (let i = 0; i < body.episodes.length; i++) {
    const epData = body.episodes[i];
    const episodeId = created[i]?.id;
    if (!episodeId) continue;

    const explicitChars = epData.characters ?? [];
    const scriptText = (epData.script || epData.idea || "").toLowerCase();

    // Collect names to link: explicit list union text-match fallback
    const namesToLink = new Set<string>();
    for (const cn of explicitChars) {
      namesToLink.add(cn.toLowerCase().trim());
    }
    if (namesToLink.size === 0) {
      // Structural split: detect character appearances in episode script
      for (const cn of allCharNames) {
        if (scriptText.includes(cn)) namesToLink.add(cn);
      }
    }

    for (const cn of namesToLink) {
      const charId = charIdByName.get(cn);
      if (!charId) continue;
      await db.insert(episodeCharacters).values({
        id: ulid(),
        episodeId,
        characterId: charId,
      });
      relationCount++;
    }
  }

  await addImportLog(
    projectId, 4, "done",
    `导入完成！创建了 ${body.characters.length} 个角色和 ${created.length} 集（${relationCount} 个角色分配）`,
    { episodeCount: created.length, characterCount: body.characters.length }
  );

  return NextResponse.json({
    episodes: created,
    characterCount: body.characters.length,
  }, { status: 201 });
}
