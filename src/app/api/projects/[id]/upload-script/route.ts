import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes } from "@/lib/db/schema";
import { eq, and, max } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { ulid } from "ulid";
import {
  chunkText,
  splitMarkdownByEpisodeHeadings,
} from "@/lib/import-utils";
import { buildScriptSplitPrompt } from "@/lib/ai/prompts/script-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { hydrateModelConfigSecrets } from "@/lib/provider-secrets";

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// File parsing helpers
// ---------------------------------------------------------------------------

async function parseTxt(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8");
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(buffer), { mergePages: true });
  return result.text;
}

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "txt":
      return parseTxt(buffer);
    case "docx":
      return parseDocx(buffer);
    case "pdf":
      return parsePdf(buffer);
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

interface EpisodeResult {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  script?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Parse form data
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const modelConfigRaw = formData.get("modelConfig") as string | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  if (!modelConfigRaw) {
    return NextResponse.json(
      { error: "No model config provided" },
      { status: 400 }
    );
  }

  const modelConfig = JSON.parse(modelConfigRaw) as {
    text: (ProviderConfig & { providerId?: string }) | null;
  };
  const resolvedModelConfig = await hydrateModelConfigSecrets(userId, modelConfig);

  if (!resolvedModelConfig?.text || !resolvedModelConfig.text.apiKey) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  // Extract text from file
  const buffer = Buffer.from(await file.arrayBuffer());
  let fullText: string;
  try {
    fullText = await extractText(buffer, file.name);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to parse file";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!fullText.trim()) {
    return NextResponse.json(
      { error: "File contains no text" },
      { status: 400 }
    );
  }

  const structured = splitMarkdownByEpisodeHeadings(fullText);
  let allEpisodes: EpisodeResult[];

  if (structured) {
    allEpisodes = structured.map((ep) => ({
      title: ep.title,
      description: ep.description,
      keywords: ep.keywords,
      idea: ep.idea,
      script: ep.script,
    }));
  } else {
    const chunks = chunkText(fullText);
    const model = createLanguageModel(resolvedModelConfig.text);
    const scriptSplitSystem = await resolvePrompt("script_split", { userId, projectId });

    const chunkPromises = chunks.map(async (chunk, idx) => {
      const prompt = buildScriptSplitPrompt(chunk, {
        chunkIndex: idx,
        totalChunks: chunks.length,
        episodeOffset: 0,
      });

      const result = await generateText({
        model,
        system: scriptSplitSystem,
        prompt,
        temperature: 0.5,
      });

      return JSON.parse(extractJSON(result.text)) as EpisodeResult[];
    });

    const chunkResults = await Promise.all(chunkPromises);
    allEpisodes = chunkResults.flat();
  }

  if (allEpisodes.length === 0) {
    return NextResponse.json(
      { error: "AI could not split the script into episodes" },
      { status: 422 }
    );
  }

  // Get current max sequence
  const [seqResult] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, projectId));

  let seq = (seqResult?.maxSeq ?? 0) + 1;

  // Create all episodes in DB
  const created = [];
  for (const ep of allEpisodes) {
    const [row] = await db
      .insert(episodes)
      .values({
        id: ulid(),
        projectId,
        title: ep.title,
        description: ep.description || "",
        keywords: ep.keywords || "",
        idea: ep.idea || "",
        script: ep.script ?? ep.idea ?? "",
        sequence: seq++,
      })
      .returning();
    created.push(row);
  }

  console.log(
    `[UploadScript] Created ${created.length} episodes (${structured ? "markdown headings" : "AI chunk split"})`
  );

  return NextResponse.json(
    { episodes: created, count: created.length },
    { status: 201 }
  );
}
