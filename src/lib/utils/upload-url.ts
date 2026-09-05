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

/**
 * 缩略图宽度允许值（像素）。
 *
 * ## 为什么要有缩略图
 *
 * 帧图是 Seedream 出的原图，实测平均 **1.09 MB**（bucket 里 88 张 PNG 共 94 MB），
 * 而它们在界面上的渲染宽度普遍只有 44–200 px。一次打开分镜页要拉十几张原图 ≈ 16 MB，
 * 而 OSS 下行流量包只有 2 GB/月（2026-09-02 已经因此欠费停服过一次）。
 *
 * ## 为什么是 OSS 实时处理而不是预生成一份缩略图存起来
 *
 * 预生成要新增 DB 列 + migration + 回填脚本 + 同步 `storage-audit.ts` 的
 * `REF_COLUMNS`（漏一列会让孤儿清理把在用文件删掉，这个坑已经踩过两次，见约定 8m）。
 * 而 OSS 的 `x-oss-process` 是**在签名 URL 上加一段指令**：零新增存储、零迁移、
 * 零回填 —— 存量的 88 张图立刻就有缩略图。实测 4448 KB → **7.4 KB**（w_320）。
 *
 * ## 为什么是闭集而不是任意宽度
 *
 * 每个宽度都是一次独立的图片处理和一个独立的浏览器缓存键。放开成任意整数，
 * 等于让调用方随手写出彼此不复用的变体，缓存命中率被稀释。三档覆盖了实际渲染尺寸：
 *
 *   - `160` —— 分镜卡片的 44×32 缩略图、看板、道具小图、素材库 64×40（@2x 仍有余量）
 *   - `320` —— 角色 80×80 头像、抽屉里的帧预览、参考图选择器网格
 *   - `640` —— 角色定妆图卡片、剧集封面轮播这类占据整张卡片宽度的图
 *
 * ⚠️ **只对图片有效。** 视频和音频引用传了也不会出错（服务端按扩展名忽略），
 * 但没有任何意义。**要看大图的地方（灯箱、预览浮层、导出、下载）必须传原图**。
 */
export const THUMB_WIDTHS = [160, 320, 640] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

export interface UploadUrlOptions {
  /** 请求缩略图而非原图。省略即原图（与改造前行为完全一致）。 */
  w?: ThumbWidth;
}

export function uploadUrl(filePath: string, opts?: UploadUrlOptions): string {
  const normalized = filePath.replace(/\\/g, "/");
  const query = opts?.w ? `?w=${opts.w}` : "";

  if (normalized.startsWith("oss://")) {
    return `/api/uploads/${OSS_URL_SEGMENT}/${normalized.slice("oss://".length)}${query}`;
  }

  // 剥掉任何以 "uploads/" 结尾的前缀（./uploads/、/app/uploads/ 等都能处理）
  return `/api/uploads/${normalized.replace(/^.*uploads\//, "")}${query}`;
}
