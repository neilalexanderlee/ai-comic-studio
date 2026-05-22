import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import {
  addImportLog,
  chunkText,
  canonicalCharacterNameKey,
  displayNameForMergedCharacter,
  pickShorterDisplayName,
} from "@/lib/import-utils";
import {
  buildImportCharacterExtractPrompt,
  buildImportCharacterExtractSystem,
  buildImportCharacterNameExtractionPrompt,
  IMPORT_CHARACTER_NAME_EXTRACTION_SYSTEM,
} from "@/lib/ai/prompts/import-character-extract";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";

export const maxDuration = 300;

interface ExtractedChar {
  name: string;
  frequency: number;
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
    text: string;
    modelConfig: { text: (ProviderConfig & { providerId?: string }) | null };
  };
  const resolvedModelConfig = await hydrateModelConfigSecrets(userId, body.modelConfig);

  if (!resolvedModelConfig?.text || !resolvedModelConfig.text.apiKey) {
    return NextResponse.json({ error: "No text model" }, { status: 400 });
  }

  const chunks = chunkText(body.text);
  const model = createLanguageModel(resolvedModelConfig.text);
  // Build system prompt from project's visualStyle.
  // resolvePrompt checks for user-level slot overrides in the DB; if none,
  // we use the visualStyle-aware default so the style tag is always correct.
  const importCharSystem = buildImportCharacterExtractSystem(project.visualStyle || "anime_2d");

  // Extract the official character-names table (系统提取·角色标准名) from the script
  // preamble so it can be prepended to every chunk — prevents the LLM from inventing
  // variant names (e.g. "酒馆老板娘（矮人）" vs "老板娘") in later chunks where the
  // table is no longer visible.
  const charTableMatch = body.text.match(
    /【系统提取·角色标准名】[\s\S]*?(?=\n---|\n##\s|$)/
  );
  const charTableHeader = charTableMatch
    ? `[官方角色名称表 — 所有角色名必须与下表完全一致]\n${charTableMatch[0].trim()}\n\n`
    : "";

  // ── Pass 1: LLM name enumeration (full text, no chunks) ──────────────────
  // Ask the model to list every character name first. Simple task → fast.
  // The resulting list becomes a mandatory cast list injected into every chunk
  // in pass-2, preventing characters from being silently dropped.
  let confirmedNames: string[] = [];
  try {
    console.log("[ImportChars] ── Pass 1: extracting name list from full text ──");
    const { text: nameListText } = await generateText({
      model,
      system: IMPORT_CHARACTER_NAME_EXTRACTION_SYSTEM,
      prompt: buildImportCharacterNameExtractionPrompt(body.text),
    });
    console.log("[ImportChars] Pass-1 raw:", nameListText.slice(0, 400));
    const parsed = JSON.parse(extractJSON(nameListText));
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "string")) {
      confirmedNames = parsed.filter((n) => n.trim().length > 0);
      console.log(`[ImportChars] Pass-1 confirmed (${confirmedNames.length}):`, confirmedNames.join("、"));
      await addImportLog(projectId, 2, "running",
        `第一轮名单：${confirmedNames.join("、")}`);
    }
  } catch (err) {
    console.warn("[ImportChars] Pass-1 FAILED (proceeding without mandatory list):", err);
  }

  await addImportLog(
    projectId, 2, "running",
    `开始角色提取，共 ${chunks.length} 块`
  );

  // Concurrent extraction from all chunks
  let chunkResults: ExtractedChar[][];
  try {
    chunkResults = await Promise.all(
      chunks.map(async (chunk, idx) => {
        await addImportLog(
          projectId, 2, "running",
          `正在处理第 ${idx + 1}/${chunks.length} 块...`
        );
        // Prepend the character table to chunks after the first so the LLM
        // always has the authoritative names visible regardless of chunk boundary.
        const chunkWithHeader = idx > 0 && charTableHeader
          ? charTableHeader + chunk
          : chunk;

        const jsonMode = {
          openai: { response_format: { type: "json_object" } },
        };
        const result = await generateText({
          model,
          system: importCharSystem,
          prompt: buildImportCharacterExtractPrompt(chunkWithHeader, confirmedNames),
          providerOptions: jsonMode,
        });

        try {
          return JSON.parse(extractJSON(result.text)) as ExtractedChar[];
        } catch {
          console.error(`[ImportChars] Chunk ${idx + 1} JSON parse failed. Raw:\n${result.text.slice(0, 500)}...`);
          await addImportLog(
            projectId, 2, "running",
            `第 ${idx + 1} 块 JSON 解析失败，正在重试...`
          );
          const retry = await generateText({
            model,
            system: importCharSystem,
            prompt: buildImportCharacterExtractPrompt(chunkWithHeader, confirmedNames) + "\n\nIMPORTANT: Return COMPLETE, VALID JSON array.",
            providerOptions: jsonMode,
          });
          return JSON.parse(extractJSON(retry.text)) as ExtractedChar[];
        }
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await addImportLog(projectId, 2, "error", `角色提取失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Merge & deduplicate by canonical key（合并「龙渊」与「龙渊（25岁）」等）
  // canonicalCharacterNameKey already normalises full-width brackets, so
  // 「魔王（人形态）」and「魔王(人形态)」resolve to the same key and merge correctly.
  const charMap = new Map<string, ExtractedChar>();
  for (const chars of chunkResults) {
    for (const c of chars) {
      const key = canonicalCharacterNameKey(c.name);
      const existing = charMap.get(key);
      if (existing) {
        existing.frequency += c.frequency;
        if (c.description.length > existing.description.length) {
          existing.description = c.description;
        }
        if ((c.visualHint?.length ?? 0) > (existing.visualHint?.length ?? 0)) {
          existing.visualHint = c.visualHint;
        }
        // scope is no longer auto-classified — skip merging it
        existing.name = pickShorterDisplayName(existing.name, c.name);
      } else {
        charMap.set(key, {
          ...c,
          name: displayNameForMergedCharacter(c.name),
        });
      }
    }
  }

  const mergedRaw = [...charMap.values()].sort((a, b) => b.frequency - a.frequency);

  // ── AI semantic dedup pass ────────────────────────────────────────────────
  // canonicalCharacterNameKey catches exact/bracket variants but misses cases
  // like "酒馆老板娘" vs "老板娘（矮人）". Ask the model to identify groups of
  // names that clearly refer to the same character and merge them.
  let merged = mergedRaw;
  if (mergedRaw.length > 1) {
    try {
      await addImportLog(projectId, 2, "running", "AI语义去重中…");
      const nameList = mergedRaw.map((c) => c.name);
      const dedupePrompt = `Below is a list of character names extracted from a screenplay. Some entries may refer to the same character using different descriptions (e.g. "酒馆老板娘" and "老板娘（矮人）" are the same person; "龙渊父亲" and "龙渊之父" are the same person).

STRICT RULES — read carefully before answering:
1. NEVER merge a child version (age ≤ 12, e.g. "龙渊(10岁)", "小龙渊") with the adult version of the same character. They look completely different and must remain separate entries.
2. Merge entries that refer to the SAME underlying entity, including:
   a. Different name variants for the same person (role prefix, title, shortened form, relational term).
   b. The same creature/entity with a CONTEXT or SETTING qualifier — e.g. "石龙" and "石龙魔兽" are the same entity; "火龙" and "魔境火龙" are the same dragon in a different realm. Context suffixes like 魔兽、魔境、(魔化) typically do NOT change visual appearance enough to warrant a separate entry.
3. NEVER merge entries that have EXPLICIT VISUAL-FORM markers indicating completely different appearances:
   - 人形态 / 龙形态 / 兽形 / 真身 → e.g. "魔王(人形态)" and "魔王(龙形态)" look COMPLETELY different — keep them as SEPARATE entries.
   - Child age markers (e.g. "龙渊(10岁)", "小龙渊") vs. adult → keep separate.
4. When in doubt, do NOT merge.

Canonical name selection: prefer the SHORTER, more commonly used base name (e.g. "石龙" over "石龙魔兽", "火龙" over "魔境火龙").

Character names:
${nameList.map((n, i) => `${i}: ${n}`).join("\n")}

Return a JSON array of merge groups. Each group is an array of indices that should be merged into ONE character (use the most descriptive/specific name as canonical — index 0 of each group).
Only include groups with 2+ members. If there are no duplicates return [].
Example: [[2,5],[7,11,14]]

Return ONLY the JSON array. No explanation.`;

      const dedupeResult = await generateText({
        model,
        system: "You are a character deduplication assistant for screenplays. Return only valid JSON. Merge context/setting variants of the same entity (e.g. '石龙'+'石龙魔兽', '火龙'+'魔境火龙'). NEVER merge entries with explicit visual-form markers like 人形态/龙形态/兽形/真身 — those look completely different and must stay separate. NEVER merge a child-age character with their adult counterpart.",
        prompt: dedupePrompt,
        providerOptions: {},
      });

      const groups = JSON.parse(extractJSON(dedupeResult.text)) as number[][];
      if (Array.isArray(groups) && groups.length > 0) {
        const toMergeInto = new Map<number, number>(); // idx → canonical idx
        for (const group of groups) {
          if (!Array.isArray(group) || group.length < 2) continue;
          const canonical = group[0];
          for (const idx of group.slice(1)) {
            if (typeof idx === "number" && idx < mergedRaw.length) {
              toMergeInto.set(idx, canonical);
            }
          }
        }

        if (toMergeInto.size > 0) {
          const result: ExtractedChar[] = [];
          mergedRaw.forEach((char, idx) => {
            const targetIdx = toMergeInto.get(idx);
            if (targetIdx !== undefined) {
              // merge into canonical
              const target = mergedRaw[targetIdx];
              target.frequency += char.frequency;
              if (char.description.length > target.description.length) {
                target.description = char.description;
              }
              if ((char.visualHint?.length ?? 0) > (target.visualHint?.length ?? 0)) {
                target.visualHint = char.visualHint;
              }
            } else if (!toMergeInto.has(idx) || toMergeInto.get(idx) === idx) {
              result.push(char);
            }
          });
          // re-add canonicals that were merge targets
          const canonicalIndices = new Set(toMergeInto.values());
          canonicalIndices.forEach((ci) => {
            if (!result.includes(mergedRaw[ci])) result.push(mergedRaw[ci]);
          });
          merged = result.sort((a, b) => b.frequency - a.frequency);
          await addImportLog(projectId, 2, "running",
            `语义去重合并了 ${toMergeInto.size} 个重复角色`);
        }
      }
    } catch (dedupeErr) {
      console.warn("[ImportChars] Semantic dedup failed, skipping:", dedupeErr);
    }
  }
  // ── end semantic dedup ────────────────────────────────────────────────────

  // All characters default to "main" — scope is now a pure UI label that users
  // adjust manually. Auto-classification was unreliable and caused confusion.
  const result = merged.map((c) => ({
    ...c,
    scope: "main" as const,
  }));

  await addImportLog(
    projectId, 2, "done",
    `提取完成，共 ${result.length} 个角色`,
    { characters: result }
  );

  return NextResponse.json({ characters: result });
}
