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
import { buildImportCharacterExtractPrompt } from "@/lib/ai/prompts/import-character-extract";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";

export const maxDuration = 300;

interface ExtractedChar {
  name: string;
  frequency: number;
  scope?: "main" | "guest";
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
  const importCharSystem = await resolvePrompt("import_character_extract", { userId, projectId });

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
          prompt: buildImportCharacterExtractPrompt(chunkWithHeader),
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
            prompt: buildImportCharacterExtractPrompt(chunkWithHeader) + "\n\nIMPORTANT: Return COMPLETE, VALID JSON array.",
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
        // Prefer scope "main" over "guest" when merging
        if (c.scope === "main") existing.scope = "main";
        existing.name = pickShorterDisplayName(existing.name, c.name);
      } else {
        charMap.set(key, {
          ...c,
          name: displayNameForMergedCharacter(c.name),
        });
      }
    }
  }

  const merged = [...charMap.values()].sort((a, b) => b.frequency - a.frequency);

  // Use LLM-provided scope when available; fall back to frequency heuristic
  // The LLM classifies by narrative centrality (not raw count), which is far more accurate.
  const result = merged.map((c) => ({
    ...c,
    scope: c.scope ?? (c.frequency >= 3 ? ("main" as const) : ("guest" as const)),
  }));

  await addImportLog(
    projectId, 2, "done",
    `提取完成，共 ${result.length} 个角色（主角 ${result.filter((c) => c.scope === "main").length}，配角 ${result.filter((c) => c.scope === "guest").length}）`,
    { characters: result }
  );

  return NextResponse.json({ characters: result });
}
