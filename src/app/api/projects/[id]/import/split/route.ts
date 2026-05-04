import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog, chunkText } from "@/lib/import-utils";
import { buildScriptSplitPrompt } from "@/lib/ai/prompts/script-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";

export const maxDuration = 300;

interface SplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  script?: string;
  characters?: string[];
}

interface CharacterSummary {
  name: string;
  scope: string;
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
    allCharacters: CharacterSummary[];
    modelConfig: { text: (ProviderConfig & { providerId?: string }) | null };
  };
  const resolvedModelConfig = await hydrateModelConfigSecrets(userId, body.modelConfig);

  if (!resolvedModelConfig?.text || !resolvedModelConfig.text.apiKey) {
    return NextResponse.json({ error: "No text model" }, { status: 400 });
  }

  const chunks = chunkText(body.text);
  const model = createLanguageModel(resolvedModelConfig.text);
  const scriptSplitSystem = await resolvePrompt("script_split", { userId, projectId });

  await addImportLog(
    projectId, 3, "running",
    `开始自动分集，共 ${chunks.length} 块`
  );

  // Build character context for prompt
  const allNames = body.allCharacters.map((c) => c.name);
  const charContext = allNames.length > 0
    ? `\n\nAll extracted characters (assign each to ONLY the episodes where they actually appear): ${allNames.join(", ")}`
    : "";

  let allEpisodes: SplitEpisode[];
  try {
    const chunkResults = await Promise.all(
      chunks.map(async (chunk, idx) => {
        await addImportLog(
          projectId, 3, "running",
          `正在处理第 ${idx + 1}/${chunks.length} 块...`
        );

        const prompt = buildScriptSplitPrompt(
          chunk + charContext,
          { chunkIndex: idx, totalChunks: chunks.length, episodeOffset: 0 }
        );

        const jsonMode = {
          openai: { response_format: { type: "json_object" } },
        };
        const result = await generateText({
          model,
          system: scriptSplitSystem,
          prompt,
          providerOptions: jsonMode,
        });

        try {
          return JSON.parse(extractJSON(result.text)) as SplitEpisode[];
        } catch {
          console.error(`[ImportSplit] Chunk ${idx + 1} JSON parse failed. Raw output:\n${result.text.slice(0, 500)}...`);
          await addImportLog(
            projectId, 3, "running",
            `第 ${idx + 1} 块 JSON 解析失败，正在重试...`
          );
          const retry = await generateText({
            model,
            system: scriptSplitSystem,
            prompt: prompt + "\n\nIMPORTANT: Return COMPLETE, VALID JSON. Fewer episodes is better than broken JSON.",
            providerOptions: jsonMode,
          });
          return JSON.parse(extractJSON(retry.text)) as SplitEpisode[];
        }
      })
    );
    allEpisodes = chunkResults
      .flat()
      .map((episode) => ({
        ...episode,
        script: episode.script || episode.idea,
      }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await addImportLog(projectId, 3, "error", `分集失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await addImportLog(
    projectId, 3, "done",
    `分集完成，共 ${allEpisodes.length} 集`,
    { episodes: allEpisodes }
  );

  return NextResponse.json({ episodes: allEpisodes });
}
