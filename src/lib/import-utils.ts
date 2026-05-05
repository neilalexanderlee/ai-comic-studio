import { db } from "@/lib/db";
import { importLogs } from "@/lib/db/schema";
import { ulid } from "ulid";

export async function addImportLog(
  projectId: string,
  step: number,
  status: "running" | "done" | "error",
  message: string,
  metadata?: unknown
) {
  await db.insert(importLogs).values({
    id: ulid(),
    projectId,
    step,
    status,
    message,
    metadata: metadata ?? {},
  });
}

export const CHUNK_SIZE = 10000;

/** 与导入分集 API 返回结构一致 */
export interface ScriptSplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  script: string;
  characters?: string[];
}

/** 识别 Markdown 中以「第 N 集」开头的标题行（如 ## 第 1 集:标题） */
const MARKDOWN_EPISODE_HEADING = /^#{1,3}\s*第\s*(\d+)\s*集(?:\s*[：:\uFF1a]\s*[^\n]*)?$/;

function extractSynopsisFromSegment(segment: string): string {
  const m = segment.match(
    /\*\*【剧情概要】\*\*\s*([\s\S]*?)(?=\n\*\*【|\n#{1,3}\s*第\s*\d+\s*集|\n\n\*\*【|$)/,
  );
  if (!m) {
    const line = segment.split(/\n/).find((l) => l.trim().length > 0);
    return (line ?? segment).trim().slice(0, 500);
  }
  return m[1].trim().replace(/\s+/g, " ").slice(0, 900);
}

function extractDurationHint(segment: string): string {
  const m =
    segment.match(/\*\*【时长】\*\*\s*:?\s*([^\n]+)/) ??
    segment.match(/\*\*时长\*\*\s*:?\s*([^\n]+)/);
  return m ? m[1].trim().slice(0, 80) : "";
}

/**
 * 若全文存在至少两处「#…第 N 集」式标题，则按标题边界切分，一标题对应一集，
 * 避免长剧本被 chunk 后再由模型二次拆成几十段「伪集数」。
 * 卷首世界观等无标题内容会并入第一集正文。
 */
export function splitMarkdownByEpisodeHeadings(
  text: string
): ScriptSplitEpisode[] | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const headingLineIndexes: number[] = [];
  const headingTitles: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (MARKDOWN_EPISODE_HEADING.test(line.trim())) {
      headingLineIndexes.push(i);
      headingTitles.push(line.replace(/^#+\s*/, "").trim());
    }
  }

  if (headingLineIndexes.length < 2) {
    return null;
  }

  if (headingLineIndexes.length > 200) {
    return null;
  }

  const episodes: ScriptSplitEpisode[] = [];
  const preambleEnd = headingLineIndexes[0];
  const preamble =
    preambleEnd > 0 ? lines.slice(0, preambleEnd).join("\n").trim() : "";

  for (let e = 0; e < headingLineIndexes.length; e++) {
    const start = headingLineIndexes[e];
    const end =
      e + 1 < headingLineIndexes.length
        ? headingLineIndexes[e + 1]
        : lines.length;
    let body = lines.slice(start, end).join("\n").trim();
    if (e === 0 && preamble) {
      body = `${preamble}\n\n${body}`;
    }

    const title = headingTitles[e] || `第 ${e + 1} 集`;
    const description = extractSynopsisFromSegment(body);
    const duration = extractDurationHint(body);
    const keywords = duration ? `时长,${duration.replace(/,/g, "，")}` : "";

    episodes.push({
      title,
      description,
      keywords,
      idea: body,
      script: body,
      characters: [],
    });
  }

  return episodes;
}

/** Split text at paragraph boundaries, each chunk ≤ CHUNK_SIZE chars */
export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

export async function extractTextFromFile(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "txt":
      return buffer.toString("utf-8");
    case "docx": {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case "pdf": {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer), {
        mergePages: true,
      });
      return result.text;
    }
    case "md":
    case "markdown":
      return buffer.toString("utf-8");
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}
