import { NextResponse } from "next/server";
import { generateText, streamText } from "ai";
import { createLanguageModel } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";
import {
  buildOutlineExpandPrompt,
  buildNovelCondensePrompt,
  NOVEL_CONDENSE_SYSTEM,
  resolveOutlineExpandSystem,
  type WholeDramaSourceType,
} from "@/lib/ai/prompts/outline-expand";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";
import { chunkText } from "@/lib/import-utils";
import { validateWholeDramaSourceLength } from "@/lib/whole-drama/limits";

export const maxDuration = 600;

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
    outline: string;
    sourceType?: WholeDramaSourceType;
    modelConfig: { text: (ProviderConfig & { providerId?: string }) | null };
  };

  const resolvedModelConfig = await hydrateModelConfigSecrets(userId, body.modelConfig);

  if (!resolvedModelConfig?.text || !resolvedModelConfig.text.apiKey) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  if (!body.outline?.trim()) {
    return NextResponse.json({ error: "Outline is required" }, { status: 400 });
  }

  const sourceType: WholeDramaSourceType = body.sourceType === "novel" ? "novel" : "idea";
  const actionLabel = sourceType === "novel" ? "小说改编" : "故事扩写";
  const lengthError = validateWholeDramaSourceLength(sourceType, body.outline);
  if (lengthError) {
    return NextResponse.json({ error: lengthError }, { status: 400 });
  }

  await addImportLog(projectId, 1, "running", `开始${actionLabel}，正在调用大模型...`);

  const model = createLanguageModel(resolvedModelConfig.text);
  let sourceText = body.outline;

  if (sourceType === "novel") {
    const chunks = chunkText(body.outline);
    if (chunks.length > 1) {
      await addImportLog(
        projectId,
        1,
        "running",
        `小说较长，先提炼 ${chunks.length} 个分段的角色、主线与关键转折...`
      );
      try {
        const summaries = await Promise.all(
          chunks.map(async (chunk, index) => {
            const result = await generateText({
              model,
              system: NOVEL_CONDENSE_SYSTEM,
              prompt: buildNovelCondensePrompt(chunk, index, chunks.length),
            });
            return `## 原文分段 ${index + 1}\n${result.text.trim()}`;
          })
        );
        sourceText = summaries.join("\n\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : "小说分段提炼失败";
        await addImportLog(projectId, 1, "error", `小说分段提炼失败: ${message}`);
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }
  }

  const outlineSystem = await resolveOutlineExpandSystem(
    { userId, projectId },
    project.visualStyle || undefined
  );

  const result = streamText({
    model,
    system: outlineSystem,
    prompt: buildOutlineExpandPrompt(sourceText, sourceType),
    onFinish: async ({ text }) => {
      try {
        // Save the generated script to the project
        await db
          .update(projects)
          .set({ script: text, updatedAt: new Date() })
          .where(eq(projects.id, projectId));

        await addImportLog(
          projectId, 1, "done",
          `${actionLabel}完成，共生成 ${text.length} 字`,
          { phase: "source_transform", sourceType, scriptLength: text.length }
        );
      } catch (err) {
        console.error("[ExpandOutline] onFinish error:", err);
        await addImportLog(projectId, 1, "error", `保存剧本失败: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
  });

  return result.toTextStreamResponse();
}
