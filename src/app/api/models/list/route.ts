import { NextResponse } from "next/server";

interface ListRequest {
  protocol: string;
  baseUrl: string;
  apiKey: string;
}

interface ModelItem {
  id: string;
  name: string;
}

function buildModelsUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, "");
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

async function fetchGeminiModels(baseUrl: string, apiKey: string): Promise<ModelItem[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { models?: { name: string; displayName?: string }[] };
  if (!data.models || !Array.isArray(data.models)) {
    throw new Error("Unexpected Gemini response format: missing models array");
  }
  return data.models.map((m) => {
    const id = m.name.replace(/^models\//, "");
    return { id, name: m.displayName || id };
  });
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
    // model 字段对应 req_key，请参考官方文档确认可用值：
    // https://www.volcengine.com/docs/85621/1791184
    if (body.protocol === "jimeng-video") {
      return NextResponse.json({
        models: [
          { id: "jimeng_i2v_v30", name: "Jimeng Video 3.0 720P (Image-to-Video)" },
        ],
      });
    }

    // ── 豆包 Seedream 图片生成（方舟 Ark API，OpenAI 兼容）─────────────
    // 参考文档：https://www.volcengine.com/docs/82379/1541523
    if (body.protocol === "doubao") {
      return NextResponse.json({
        models: [
          { id: "doubao-seedream-5-0-lite-250113", name: "Doubao Seedream 5.0 Lite" },
          { id: "doubao-seedream-4-5-251128",      name: "Doubao Seedream 4.5" },
          { id: "doubao-seedream-4-0-250828",      name: "Doubao Seedream 4.0" },
        ],
      });
    }

    // ── Doubao Seedance 视频生成（方舟 Ark API）───────────────────────
    // 参考文档：https://www.volcengine.com/docs/82379/1520757
    if (body.protocol === "seedance") {
      return NextResponse.json({
        models: [
          { id: "doubao-seedance-2-0-260128",      name: "Doubao Seedance 2.0" },
          { id: "doubao-seedance-2-0-lite-260505", name: "Doubao Seedance 2.0 Lite" },
          { id: "doubao-seedance-1-5-pro-250528",  name: "Doubao Seedance 1.5 Pro" },
          { id: "doubao-seedance-1-5-lite-250601", name: "Doubao Seedance 1.5 Lite" },
        ],
      });
    }

    if (!body.baseUrl) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }
    if (!body.apiKey) {
      return NextResponse.json({ error: "API Key is required" }, { status: 400 });
    }

    const models =
      body.protocol === "gemini"
        ? await fetchGeminiModels(body.baseUrl, body.apiKey)
        : await fetchModels(body.baseUrl, body.apiKey);
    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[models/list] Error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
