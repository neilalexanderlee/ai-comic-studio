/**
 * 把**存储引用**转成浏览器可访问的 URL，统一走 `/api/uploads/[...path]`。
 *
 * 两种引用形态（见 `src/lib/storage/artifact-store.ts`）：
 *   - 本地：`./uploads/frames/abc.png` → `/api/uploads/frames/abc.png`
 *   - OSS ：`oss://frames/abc.png`      → `/api/uploads/_oss/frames/abc.png`
 *
 * 为什么 OSS 也绕回自家路由，而不是直接给签名 URL：
 * 本函数是**纯客户端**的（46 个调用点），客户端拿不到 OSS 密钥，签不了名。
 * 所以由 `_oss/` 前缀通知服务端「这是个 OSS 引用」，服务端鉴权后再 302
 * 跳到临时签名 URL。这样既不用把 46 个调用点全改成服务端渲染，
 * 又保住了「bucket 私有 + 访问要鉴权」。
 */

/** OSS 引用在 URL 路径里的标记段 */
export const OSS_URL_SEGMENT = "_oss";

export function uploadUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.startsWith("oss://")) {
    return `/api/uploads/${OSS_URL_SEGMENT}/${normalized.slice("oss://".length)}`;
  }

  // 剥掉任何以 "uploads/" 结尾的前缀（./uploads/、/app/uploads/ 等都能处理）
  return `/api/uploads/${normalized.replace(/^.*uploads\//, "")}`;
}
