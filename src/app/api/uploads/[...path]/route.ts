import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "@/lib/api-guard";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

/**
 * 静态产物读取。
 *
 * ⚠️ 一期只做到「必须有身份」这一层。文件在磁盘上是按类型扁平存放的
 * （`uploads/{frames,videos,bgm,...}/<ULID>.<ext>`），路径里不含 ownerId，
 * 无法在这里低成本地反查归属。
 *
 * 残留风险：**已登录用户 A 若知道用户 B 的文件名，仍可读取**。当前靠 ULID/UUID
 * 文件名不可枚举兜底。真正的修复是二期的 OSS 私有 bucket + STS 签名 URL —— 那时
 * URL 由服务端签发，本路由整体退役。在此之前不要把本路由当作已经安全。
 *
 * 之所以不在一期做签名 URL：`uploadUrl()`（`src/lib/utils/upload-url.ts`）是纯客户端
 * 函数、46 个调用点，客户端拿不到签名密钥；要签名就得把 URL 生成挪到服务端序列化时，
 * 那是与 OSS 迁移同等规模的改动，放在二期一次做完更合算。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // 关掉「任何人拿到 URL 就能下载任意用户成片」这一条：至少要带身份 cookie
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;

  const { path: segments } = await params;
  const filePath = path.join(uploadDir, ...segments);

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  const resolvedUploadDir = path.resolve(uploadDir);
  if (!resolved.startsWith(resolvedUploadDir)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(resolved);

  return new NextResponse(buffer, {
    headers: { "Content-Type": contentType },
  });
}
