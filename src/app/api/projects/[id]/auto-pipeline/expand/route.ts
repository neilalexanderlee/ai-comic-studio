import { NextResponse } from "next/server";
import { streamText } from "ai";
import { createLanguageModel } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";
import {
  buildOutlineExpandPrompt,
  resolveOutlineExpandSystem,
} from "@/lib/ai/prompts/outline-expand";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";

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
    modelConfig: { text: (ProviderConfig & { providerId?: string }) | null };
  };

  const resolvedModelConfig = await hydrateModelConfigSecrets(userId, body.modelConfig);

  if (!resolvedModelConfig?.text || !resolvedModelConfig.text.apiKey) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  if (!body.outline?.trim()) {
    return NextResponse.json({ error: "Outline is required" }, { status: 400 });
  }

  await addImportLog(projectId, 1, "running", "开始扩写大纲，正在调用大模型...");

  const model = createLanguageModel(resolvedModelConfig.text);

  const outlineSystem = await resolveOutlineExpandSystem({ userId, projectId });

  const result = streamText({
    model,
    system: outlineSystem,
    prompt: buildOutlineExpandPrompt(body.outline),
    onFinish: async ({ text }) => {
      try {
        // Save the generated script to the project
        await db
          .update(projects)
          .set({ script: text, updatedAt: new Date() })
          .where(eq(projects.id, projectId));

        await addImportLog(
          projectId, 1, "done",
          `大纲扩写完成，共生成 ${text.length} 字`,
          { scriptLength: text.length }
        );
      } catch (err) {
        console.error("[ExpandOutline] onFinish error:", err);
        await addImportLog(projectId, 1, "error", `保存剧本失败: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
  });

  return result.toTextStreamResponse();
}
