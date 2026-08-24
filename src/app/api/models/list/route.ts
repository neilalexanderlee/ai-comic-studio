import { NextResponse } from "next/server";
import {
  isGeminiModelCompatible,
  type ModelCapability,
} from "@/lib/ai/model-capabilities";

interface ListRequest {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  capability?: ModelCapability;
}

interface ModelItem {
  id: string;
  name: string;
}

function buildModelsUrl(baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, "");
  // If baseUrl already ends with /v1, don't duplicate
  if (url.endsWith("/v1")) {
    return url + "/models";
  }
  return url + "/v1/models";
}

async function fetchModels(baseUrl: string, apiKey: string): Promise<ModelItem[]> {
  const url = buildModelsUrl(baseUrl);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: { id: string }[] };
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Unexpected response format: missing data array");
  }
  return data.data.map((m) => ({ id: m.id, name: m.id }));
}

// Common Gemini models — returned as fallback when googleapis.com is unreachable
// (e.g. network blocked in some regions). Update this list as new models are released.
const GEMINI_FALLBACK: Record<"text" | "image" | "video", ModelItem[]> = {
  text: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
  image: [
    { id: "gemini-2.5-flash-image", name: "Nano Banana" },
    { id: "gemini-3-pro-image-preview", name: "Nano Banana Pro" },
    { id: "gemini-3.1-flash-image-preview", name: "Nano Banana 2" },
  ],
  video: [
    { id: "veo-3.1-generate-preview", name: "Veo 3.1" },
    { id: "veo-3.0-generate-001", name: "Veo 3.0" },
  ],
};

async function fetchGeminiModels(
  baseUrl: string,
  apiKey: string,
  capability: ModelCapability = "text"
): Promise<ModelItem[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Key is wrong / quota exceeded — surface the real error, don't fallback
      throw new Error(`Gemini API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as { models?: { name: string; displayName?: string }[] };
    if (!data.models || !Array.isArray(data.models)) {
      throw new Error("Unexpected Gemini response format: missing models array");
    }
    const compatibleModels = data.models.filter((m) =>
      isGeminiModelCompatible(m.name, capability)
    );
    return compatibleModels.map((m) => {
      const id = m.name.replace(/^models\//, "");
      return { id, name: m.displayName || id };
    });
  } catch (err) {
    // Network-level failure (blocked, timeout, DNS) — return hardcoded fallback
    // so the user can still pick a model manually.
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" ||
        err.message.startsWith("fetch failed") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ENOTFOUND"))
    ) {
      console.warn("[models/list] Gemini API unreachable, returning fallback list:", err.message);
      const fallbackCapability = capability === "image" || capability === "video"
        ? capability
        : "text";
      return GEMINI_FALLBACK[fallbackCapability];
    }
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ListRequest;

    // ── Kling 图片 / 视频 ───────────────────────────────────────────────
    if (body.protocol === "kling") {
      return NextResponse.json({
        models: [
          { id: "kling-v1",          name: "Kling v1" },
          { id: "kling-v1-5",        name: "Kling v1.5" },
          { id: "kling-v1-6",        name: "Kling v1.6" },
          { id: "kling-v2",          name: "Kling v2" },
          { id: "kling-v2-new",      name: "Kling v2 (New)" },
          { id: "kling-v2-1",        name: "Kling v2.1" },
          { id: "kling-v2-master",   name: "Kling v2 Master" },
          { id: "kling-v2-1-master", name: "Kling v2.1 Master" },
          { id: "kling-v2-5-turbo",  name: "Kling v2.5 Turbo" },
        ],
      });
    }

    // ── 即梦AI 图片生成（火山引擎 Visual API）──────────────────────────
    // model 字段对应 req_key，请参考官方文档确认可用值：
    // https://www.volcengine.com/docs/85621/2288388
    if (body.protocol === "jimeng") {
      return NextResponse.json({
        models: [
          { id: "jimeng_high_aes_general_v21_L", name: "Jimeng Image Gen (General)" },
        ],
      });
    }

    // ── 即梦AI 视频生成（火山引擎 Visual API）──────────────────────────
    // 720P 单 req_key 覆盖图生（含首尾帧）：https://www.volcengine.com/docs/85621/1792710
    // 1080P 官方按模式多个 req_key，客户端用 jimeng_i2v_v30_1080 自动映射：
    // https://www.volcengine.com/docs/85621/1792711
    if (body.protocol === "jimeng-video") {
      return NextResponse.json({
        models: [
          { id: "jimeng_i2v_v30", name: "Jimeng Video 3.0 720P" },
          { id: "jimeng_i2v_v30_1080", name: "Jimeng Video 3.0 1080P" },
        ],
      });
    }

    // ── MiniMax 音乐生成 ────────────────────────────────────────────────
    // 有效 model 值来自官方文档，不支持动态拉取（无 /v1/models 端点）。
    // music-2.6 / music-cover 仅限 Token Plan 及付费用户；-free 后缀版对所有用户开放。
    // 文档：https://platform.minimaxi.com/docs/api-reference/music-generation
    if (body.protocol === "minimax") {
      return NextResponse.json({
        models: [
          { id: "music-2.6-free",   name: "Music 2.6 Free（所有用户可用）" },
          { id: "music-2.6",        name: "Music 2.6（付费/Token Plan）" },
          { id: "music-cover-free", name: "Music Cover Free（翻唱，所有用户）" },
          { id: "music-cover",      name: "Music Cover（翻唱，付费）" },
        ],
      });
    }

    // ── MiniMax H3 视频生成（v2 异步任务 API）──────────────────────────
    // 官方无模型列表端点，模型固定为 MiniMax-H3。
    // 文档：https://platform.minimax.io/docs/api-reference/video-generation-v2-create
    if (body.protocol === "minimax-video") {
      return NextResponse.json({
        models: [{ id: "MiniMax-H3", name: "MiniMax H3" }],
      });
    }

    // ── 豆包 Seedream 图片生成（方舟 Ark API，OpenAI 兼容）─────────────
    // 参考文档：https://www.volcengine.com/docs/82379/1541523
    if (body.protocol === "doubao") {
      const DOUBAO_FALLBACK: ModelItem[] = [
        { id: "doubao-seedream-5-0-260128",      name: "Doubao Seedream 5.0" },
        { id: "doubao-seedream-4-5-251128",      name: "Doubao Seedream 4.5" },
        { id: "doubao-seedream-4-0-250828",      name: "Doubao Seedream 4.0" },
      ];

      // 尝试从方舟 API 动态拉取，过滤图片生成模型（ID 含 seedream）
      if (body.baseUrl && body.apiKey) {
        try {
          const base = body.baseUrl.replace(/\/+$/, "");
          const modelsUrl = `${base}/models`;
          const res = await fetch(modelsUrl, {
            headers: { Authorization: `Bearer ${body.apiKey}` },
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const data = (await res.json()) as { data?: { id: string }[] };
            const imageModels = (data.data ?? [])
              .map((m) => m.id)
              .filter((id) => /seedream/i.test(id));
            if (imageModels.length > 0) {
              const fallbackMap = new Map(DOUBAO_FALLBACK.map((m) => [m.id, m.name]));
              return NextResponse.json({
                models: imageModels.map((id) => ({ id, name: fallbackMap.get(id) ?? id })),
              });
            }
          }
        } catch {
          // 静默降级
        }
      }

      return NextResponse.json({ models: DOUBAO_FALLBACK });
    }

    // ── Doubao Seedance 视频生成（方舟 Ark API）───────────────────────
    // 参考文档：https://www.volcengine.com/docs/82379/1520757
    // 模型 ID 参考：https://www.volcengine.com/docs/82379/2291680
    // 注：doubao-* 为中国区 Volcengine Ark 的 ID；国际区 BytePlus 对应 dreamina-*
    if (body.protocol === "seedance") {
      // 兜底列表（官方文档确认，万一 API 拉取失败时使用）
      const SEEDANCE_FALLBACK: ModelItem[] = [
        { id: "doubao-seedance-2-0-260128",      name: "Doubao Seedance 2.0 (15s, up to 1080p)" },
        { id: "doubao-seedance-2-0-fast-260128", name: "Doubao Seedance 2.0 Fast (15s, up to 720p)" },
        { id: "doubao-seedance-1-5-pro-251215",  name: "Doubao Seedance 1.5 Pro (12s, up to 1080p)" },
        { id: "doubao-seedance-1-5-lite-250601", name: "Doubao Seedance 1.5 Lite (10s, 480p only)" },
      ];

      // 尝试从方舟 API 动态拉取，过滤出视频生成模型（ID 含 seedance/dreamina）
      if (body.baseUrl && body.apiKey) {
        try {
          // 方舟 baseUrl 格式为 .../api/v3，直接追加 /models（非 OpenAI 的 /v1/models）
          const base = body.baseUrl.replace(/\/+$/, "");
          const modelsUrl = `${base}/models`;
          const res = await fetch(modelsUrl, {
            headers: { Authorization: `Bearer ${body.apiKey}` },
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const data = (await res.json()) as { data?: { id: string }[] };
            const videoModels = (data.data ?? [])
              .map((m) => m.id)
              .filter((id) => /seedance|dreamina.*video/i.test(id));
            if (videoModels.length > 0) {
              // 匹配兜底列表里的显示名；没有则用 ID 本身
              const fallbackMap = new Map(SEEDANCE_FALLBACK.map((m) => [m.id, m.name]));
              return NextResponse.json({
                models: videoModels.map((id) => ({ id, name: fallbackMap.get(id) ?? id })),
              });
            }
          }
        } catch {
          // 网络错误或超时：静默降级到兜底列表
        }
      }

      return NextResponse.json({ models: SEEDANCE_FALLBACK });
    }

    if (!body.baseUrl) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }
    if (!body.apiKey) {
      return NextResponse.json({ error: "API Key is required" }, { status: 400 });
    }

    const models =
      body.protocol === "gemini"
        ? await fetchGeminiModels(body.baseUrl, body.apiKey, body.capability)
        : await fetchModels(body.baseUrl, body.apiKey);
    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[models/list] Error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
