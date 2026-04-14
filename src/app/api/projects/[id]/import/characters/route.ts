import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog, chunkText } from "@/lib/import-utils";
import { buildImportCharacterExtractPrompt } from "@/lib/ai/prompts/import-character-extract";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
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
  const importCharSystem = await resolvePrompt("import_character_extract", { userId, projectId });

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

        const jsonMode = {
          openai: { response_format: { type: "json_object" } },
        };
        const result = await generateText({
          model,
          system: importCharSystem,
          prompt: buildImportCharacterExtractPrompt(chunk),
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
            prompt: buildImportCharacterExtractPrompt(chunk) + "\n\nIMPORTANT: Return COMPLETE, VALID JSON array.",
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

  // Merge & deduplicate by name, sum frequencies
  const charMap = new Map<string, ExtractedChar>();
  for (const chars of chunkResults) {
    for (const c of chars) {
      const key = c.name.toLowerCase().trim();
      const existing = charMap.get(key);
      if (existing) {
        existing.frequency += c.frequency;
        // Keep longer description
        if (c.description.length > existing.description.length) {
          existing.description = c.description;
        }
      } else {
        charMap.set(key, { ...c });
      }
    }
  }

  const merged = [...charMap.values()].sort((a, b) => b.frequency - a.frequency);

  // Classify: frequency >= 2 = main, else guest
  const result = merged.map((c) => ({
    ...c,
    scope: c.frequency >= 2 ? ("main" as const) : ("guest" as const),
  }));

  await addImportLog(
    projectId, 2, "done",
    `提取完成，共 ${result.length} 个角色（主角 ${result.filter((c) => c.scope === "main").length}，配角 ${result.filter((c) => c.scope === "guest").length}）`,
    { characters: result }
  );

  return NextResponse.json({ characters: result });
}
