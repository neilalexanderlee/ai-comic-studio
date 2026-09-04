import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireUser } from "@/lib/api-guard";
import { OSS_URL_SEGMENT } from "@/lib/utils/upload-url";
import { resolveArtifactUrl, SIGNED_URL_WINDOW_SECONDS } from "@/lib/storage/artifact-store";

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

  // `?download=<文件名>` → 强制「另存为」而不是在浏览器里直接播放。
  // 成片迁到 OSS 之后前端的 `<a download>` 不再生效（302 之后是跨域地址，
  // download 属性会被忽略），所以必须由服务端把 content-disposition 定下来。
  const downloadFilename = new URL(request.url).searchParams.get("download") || undefined;

  // OSS 引用：鉴权通过后 302 到临时签名 URL。
  // 不在这里代理下载 —— 那会让所有流量绕经我们的服务器，白白吃掉带宽，
  // 而 OSS 直传是免费的（上传免费、下行走用户就近节点）。
  if (segments[0] === OSS_URL_SEGMENT) {
    const key = segments.slice(1).join("/");
    if (!key) return NextResponse.json({ error: "Missing object key" }, { status: 400 });
    try {
      const res = NextResponse.redirect(
        resolveArtifactUrl(`oss://${key}`, { downloadFilename }),
        302
      );
      // 让浏览器缓存这一跳。没有它，每次播放都要重新走一遍 302 并重新下载文件——
      // 签名 URL 已按窗口对齐（见 SIGNED_URL_WINDOW_SECONDS），窗口内 URL 逐字节相同，
      // 所以缓存住的重定向目标一定还在有效期内。private：签名 URL 因人而异，不得进共享缓存。
      res.headers.set(
        "Cache-Control",
        // 下载那一跳是一次性的，签名里带了 content-disposition，缓存它没有意义
        downloadFilename ? "private, no-store" : `private, max-age=${SIGNED_URL_WINDOW_SECONDS}`
      );
      return res;
    } catch (err) {
      console.error("[uploads] 签发 OSS 签名 URL 失败:", err);
      return NextResponse.json({ error: "OSS 未配置或签名失败" }, { status: 500 });
    }
  }

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
    headers: {
      "Content-Type": contentType,
      // 本地分支同样认 ?download= —— 两条路径的行为必须一致，
      // 否则「配没配 OSS」会变成用户看得见的差异
      ...(downloadFilename
        ? { "Content-Disposition": `attachment; filename="${encodeURIComponent(downloadFilename)}"` }
        : {}),
    },
  });
}
