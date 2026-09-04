import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { requireUser } from "@/lib/api-guard";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { addImportLog } from "@/lib/import-utils";
import { validateWholeDramaSourceLength } from "@/lib/whole-drama/limits";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/visual-style-presets";
import { checkProjectQuota, planLimitResponse } from "@/lib/billing/plan-limits";
import { resolveFeatures } from "@/lib/billing/subscription";

export async function GET(request: Request) {
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;
  const userId = guard.userId;
  const allProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
  return NextResponse.json(allProjects);
}

export async function POST(request: Request) {
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;
  const userId = guard.userId;
  const body = (await request.json()) as {
    title: string;
    script?: string;
    idea?: string;
    wholeDramaSource?: "idea" | "novel" | "script";
    visualStyle?: string;
  };
  const id = ulid();

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  // 套餐的项目数量上限。放在参数校验之后、写库之前 ——
  // 未启用计费时 checkProjectQuota 直接短路返回 null，连库都不查。
  const quota = await checkProjectQuota(userId, await resolveFeatures(userId));
  if (quota) return planLimitResponse(quota);

  // 画风必须在项目创建时就落地——整剧模式创建后会立即触发角色提取，
  // 若此时 visualStyle 仍是 schema default("anime_2d")，角色描述会被错误地打上
  // 现代2D动漫的风格锚定词。前端"新建项目"弹窗已加画风选择器，这里做校验兜底。
  const resolvedVisualStyle =
    body.visualStyle && VISUAL_STYLE_PRESETS[body.visualStyle] ? body.visualStyle : undefined;

  const wholeDramaSource =
    body.wholeDramaSource === "idea" ||
    body.wholeDramaSource === "novel" ||
    body.wholeDramaSource === "script"
      ? body.wholeDramaSource
      : undefined;

  if (body.wholeDramaSource !== undefined && !wholeDramaSource) {
    return NextResponse.json({ error: "Invalid whole-drama source" }, { status: 400 });
  }
  if (wholeDramaSource) {
    const sourceText = wholeDramaSource === "idea" ? body.idea || "" : body.script || "";
    const lengthError = validateWholeDramaSourceLength(wholeDramaSource, sourceText);
    if (lengthError) {
      return NextResponse.json({ error: lengthError }, { status: 400 });
    }
  }

  const [project] = await db
    .insert(projects)
    .values({
      id,
      userId,
      title: body.title.trim(),
      script: body.script || "",
      idea: body.idea || "",
      status: wholeDramaSource ? "processing" : "draft",
      ...(resolvedVisualStyle ? { visualStyle: resolvedVisualStyle } : {}),
    })
    .returning();

  if (wholeDramaSource) {
    try {
      await addImportLog(project.id, 0, "done", "整剧模式项目已创建", {
        phase: "whole_drama_init",
        sourceType: wholeDramaSource,
      });
    } catch (err) {
      await db.delete(projects).where(eq(projects.id, project.id));
      console.error("[CreateProject] failed to initialize whole-drama workflow", err);
      return NextResponse.json({ error: "Failed to initialize whole-drama workflow" }, { status: 500 });
    }
  }

  return NextResponse.json(project, { status: 201 });
}
