/**
 * 将 registry 组装的长首/尾帧 prompt 压缩为增强层输入摘要。
 * Seedream 增强应改写短静帧句，而非整页 === 区块模板。
 */

const DEFAULT_MAX_CHARS = 900;
const COMPRESS_THRESHOLD = 700;

function extractSection(raw: string, headerPattern: RegExp): string | undefined {
  const match = raw.match(headerPattern);
  if (match?.index === undefined) return undefined;
  const start = match.index + match[0].length;
  const rest = raw.slice(start);
  const nextHeader = rest.search(/\n=== /);
  const body = (nextHeader >= 0 ? rest.slice(0, nextHeader) : rest)
    .replace(/^[\s\n]+/, "")
    .replace(/⚠️[^\n]*\n/g, "")
    .trim();
  return body || undefined;
}

/**
 * 从完整 frame prompt 提取增强用摘要（保留画风锁、主静帧、情节上下文、落幅/起幅）。
 */
export function compressFramePromptForEnhancement(
  raw: string,
  maxChars: number = DEFAULT_MAX_CHARS
): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length <= COMPRESS_THRESHOLD) return trimmed;

  const parts: string[] = [];

  const styleLine = trimmed.match(/视频静帧画面[^\n]*/)?.[0];
  if (styleLine) parts.push(styleLine.trim());

  const primary =
    extractSection(trimmed, /=== 【最高优先级】首帧静止画面[^\n]*===\s*\n/) ??
    extractSection(trimmed, /=== 【最高优先级】尾帧静止画面[^\n]*===\s*\n/);
  if (primary) parts.push(primary.slice(0, 420));

  const context = extractSection(trimmed, /=== 镜头情节上下文[^\n]*===\s*\n/);
  if (context) parts.push(`（情节上下文，勿画进静帧：${context.slice(0, 160)}）`);

  const camera =
    extractSection(trimmed, /=== 首帧构图视角[^\n]*===\s*\n/) ??
    extractSection(trimmed, /=== 尾帧构图视角[^\n]*===\s*\n/);
  if (camera) parts.push(`构图：${camera.slice(0, 120)}`);

  if (trimmed.includes("环境/群演")) {
    parts.push("（环境/群演镜：代码已切换环境渲染块，勿用插槽内「角色占40-70%」）");
  }

  if (parts.length > 0) {
    const joined = parts.join("\n");
    return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
  }

  const stripped = trimmed
    .replace(/^===[^\n]+\n/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped.length > maxChars ? stripped.slice(0, maxChars) : stripped;
}
