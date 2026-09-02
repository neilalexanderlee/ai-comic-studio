/**
 * 给 OSS bucket 配置 CORS 规则。
 *
 * 用法：
 *   pnpm oss:cors                                  # 查看当前规则
 *   pnpm oss:cors --apply                          # 用默认来源（含 localhost:3007）写入
 *   pnpm oss:cors --apply --origin https://你的域名  # 追加生产域名（可重复传）
 *
 * ## 为什么必须配
 *
 * 产物存在私有 bucket 里，前端拿到的是 `/api/uploads/_oss/<key>`，
 * 服务端鉴权后 **302 跳到 OSS 签名 URL**。跳转后就是跨域请求了。
 *
 * - `<img src>` / `<video src>` **不需要** CORS，所以缩略图、下载都正常
 * - 但 `fetch()` **需要** CORS，浏览器会因为响应缺少 Access-Control-Allow-Origin 而拦截
 *
 * 视频编辑器就踩了这一条：`VideoPreview.tsx` 用 `fetch()` 把视频流喂给 `MP4Clip`，
 * 没有 CORS 时报 `TypeError: Failed to fetch`，而且**看不出**是跨域问题。
 *
 * ## 安全性
 *
 * 放开 CORS **不等于**放开访问：bucket 仍是私有的，任何请求都必须带有效签名，
 * 匿名裸 URL 依然 403。CORS 只决定「哪个页面的 JS 能读取响应」，
 * 不决定「谁能拿到数据」。
 *
 * ## 部署到生产时记得重跑
 *
 * 规则里必须包含线上域名，否则线上编辑器会复现同样的 Failed to fetch。
 */

import "dotenv/config";

const APPLY = process.argv.includes("--apply");

/** 从命令行收集 --origin（可重复） */
function extraOrigins(): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--origin" && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

const DEFAULT_ORIGINS = [
  "http://localhost:3007",
  "http://127.0.0.1:3007",
];

function client() {
  const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = process.env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    throw new Error("未配置 OSS（OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET）");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OSS = require("ali-oss");
  return new OSS({
    region: OSS_REGION,
    bucket: OSS_BUCKET,
    accessKeyId: OSS_ACCESS_KEY_ID,
    accessKeySecret: OSS_ACCESS_KEY_SECRET,
    secure: true,
  });
}

async function main() {
  const oss = client();
  const bucket = process.env.OSS_BUCKET!;

  try {
    const cur = await oss.getBucketCORS(bucket);
    console.log("当前 CORS 规则：");
    console.log(JSON.stringify(cur.rules, null, 2));
  } catch (err) {
    const code = (err as { code?: string }).code;
    console.log(`当前 CORS 规则：${code === "NoSuchCORSConfiguration" ? "（未配置）" : code}`);
  }

  const origins = [...new Set([...DEFAULT_ORIGINS, ...extraOrigins()])];

  if (!APPLY) {
    console.log("\n将要写入的来源：");
    for (const o of origins) console.log("  " + o);
    console.log("\n演练模式。确认后加 --apply 执行；生产域名用 --origin https://... 追加。");
    return;
  }

  await oss.putBucketCORS(bucket, [
    {
      allowedOrigin: origins,
      // GET 取素材，HEAD 供存在性检查
      allowedMethod: ["GET", "HEAD"],
      // Range 是关键：视频要分段拉取（seek / 流式播放）
      allowedHeader: ["*"],
      // 让前端能读到这些响应头，MP4Clip 依赖 content-length 判断流长度
      exposeHeader: ["ETag", "Content-Length", "Content-Type", "Accept-Ranges", "Content-Range"],
      maxAgeSeconds: 3600,
    },
  ]);

  const after = await oss.getBucketCORS(bucket);
  console.log("\n✓ 已写入。当前规则：");
  console.log(JSON.stringify(after.rules, null, 2));
}

main().catch((err) => {
  console.error("失败:", err);
  process.exit(1);
});
