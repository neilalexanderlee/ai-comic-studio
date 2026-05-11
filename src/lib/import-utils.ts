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

function compactKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/**
 * 全角括号 → 半角，全角冒号 → 半角，统一空格。
 * 用于所有角色名归一化的第一步。
 */
function normalizeParens(s: string): string {
  return s
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[：]/g, ":")
    .trim();
}

/**
 * Strip parentheticals from a character name for deduplication, preserving only
 * true identity markers (形态 variants and child-age suffixes).
 *
 * Rules applied in order:
 * 1. Full-width brackets unified to half-width (normalizeParens must run first)
 * 2. Age suffix (N岁, N≤12) → kept as ::childN key component
 * 3. Age suffix (N岁, N≥13) → stripped (adult age is never part of canonical identity)
 * 4. 形态 suffix e.g. (人形态), (龙形态) → KEPT (these are distinct character forms)
 * 5. All other parentheticals (role, title, race, emotion) → stripped so that
 *    "白夜(魔族将军)" and "白夜" → same key,
 *    "格朗(矮人斧手)" and "格朗" → same key,
 *    "翠缇娜(精灵公主)" and "翠缇娜" → same key.
 */
export function canonicalCharacterNameKey(raw: string): string {
  const trimmed = normalizeParens(raw).replace(/\s+/g, " ");

  // Check for age suffix — child (≤12) kept as separate key; adult (≥13) stripped
  const ageMatch = trimmed.match(
    /^(.+?)[(]\s*(\d{1,3})\s*岁(?:\s*[·•][^)]{0,24})?\s*[)]\s*$/u
  );
  if (ageMatch) {
    const base = compactKey(ageMatch[1].trim());
    const age = parseInt(ageMatch[2], 10);
    if (age <= 12) return `${base}::child${age}`;
    return base; // adult age suffix stripped
  }

  // Strip parentheticals, but PRESERVE 形态 identity markers
  const stripped = trimmed.replace(/[(][^)]*[)]/g, (match) => {
    const inner = match.slice(1, -1).trim();
    // Strip ·emotion suffix, keep only the base form identifier if it ends in 形态
    const formMatch = inner.match(/^([^·•]*形态)/);
    if (formMatch) return `(${formMatch[1].trim()})`;
    // Pure 形态 with no suffix
    if (/形态$/.test(inner)) return `(${inner})`;
    // Everything else (age N≥13, role/title/race/emotion) → strip
    return "";
  });

  return compactKey(stripped.trim());
}

/**
 * 合并后展示用短名：仅去掉**成年冗余**的「（N岁）」（N≥13）；保留 N≤12 的括注。
 */
export function displayNameForMergedCharacter(raw: string): string {
  let t = raw.trim();
  const ageTail = t.match(
    /^(.+?)[（(]\s*(\d{1,3})\s*岁(?:\s*[·•][^)）]{0,24})?\s*[)）]\s*$/u
  );
  if (ageTail) {
    const age = parseInt(ageTail[2], 10);
    if (age <= 12) {
      return t;
    }
  }
  t = t
    .replace(
      /\s*[（(]\s*\d{1,3}\s*岁(?:\s*[·•][^)）]{0,24})?\s*[)）]\s*$/u,
      ""
    )
    .trim();
  return t || raw.trim();
}

export function pickShorterDisplayName(a: string, b: string): string {
  const da = displayNameForMergedCharacter(a);
  const db = displayNameForMergedCharacter(b);
  if (da.length === 0) return db;
  if (db.length === 0) return da;
  return da.length <= db.length ? da : db;
}

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
