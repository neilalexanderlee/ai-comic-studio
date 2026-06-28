import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { bootstrap } from "@/lib/bootstrap";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getProviderSecret } from "@/lib/provider-secrets";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

interface MusicGenerateParams {
  prompt: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  targetDuration?: number;  // 目标时长（秒），可选
}

interface MusicGenerateResult {
  hexAudio: string;
  durationMs: number;
  format: string;
}

// ── 各协议实现 ────────────────────────────────────────────────────────────────

/**
 * MiniMax Music 2.x
 * 文档：https://platform.minimaxi.com/docs/api-reference/music-generation
 * 域名：https://api.minimaxi.com
 */
async function generateWithMinimax(params: MusicGenerateParams): Promise<MusicGenerateResult> {
  const { prompt, modelId, baseUrl, apiKey, targetDuration } = params;
  const url = `${baseUrl.replace(/\/$/, "")}/v1/music_generation`;

  // 将目标时长注入 prompt 末尾，MiniMax 会尽量匹配
  const promptWithDuration = targetDuration
    ? `${prompt}，时长约${targetDuration}秒`
    : prompt;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId || "music-2.6-free",
      prompt: promptWithDuration,
      is_instrumental: true,
      output_format: "hex",
      audio_setting: { sample_rate: 44100, bitrate: 256000, format: "mp3" },
    }),
  });

  const result = (await res.json()) as {
    data?: { audio?: string; status?: number };
    base_resp?: { status_code?: number; status_msg?: string };
    extra_info?: { music_duration?: number };
  };

  if (!res.ok || result.base_resp?.status_code !== 0) {
    const msg = result.base_resp?.status_msg ?? `HTTP ${res.status}`;
    throw new Error(`MiniMax: ${msg}`);
  }

  const hexAudio = result.data?.audio;
  if (!hexAudio) throw new Error("MiniMax 返回了空音频");

  return {
    hexAudio,
    durationMs: result.extra_info?.music_duration ?? 0,
    format: "mp3",
  };
}

// ── 协议路由 ──────────────────────────────────────────────────────────────────

async function callMusicProvider(
  protocol: string,
  params: MusicGenerateParams
): Promise<MusicGenerateResult> {
  switch (protocol) {
    case "minimax":
      return generateWithMinimax(params);
    default:
      throw new Error(`不支持的音乐生成协议: ${protocol}`);
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/bgm/generate
 * 调用已配置的音乐生成 provider，生成纯器乐 BGM，保存 mp3 返回 filePath + duration。
 *
 * Body: {
 *   prompt: string;
 *   providerId: string;
 *   protocol: string;    // "minimax" | ...
 *   baseUrl: string;     // provider 配置的 base URL
 *   modelId?: string;
 * }
 */
export async function POST(request: NextRequest) {
  await bootstrap();

  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
  }

  const body = (await request.json()) as {
    prompt?: string;
    providerId?: string;
    protocol?: string;
    baseUrl?: string;
    modelId?: string;
    targetDuration?: number;
  };

  const { prompt, providerId, protocol, baseUrl, modelId, targetDuration } = body;

  if (!prompt?.trim()) {
    return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
  }
  if (!providerId || !protocol || !baseUrl) {
    return NextResponse.json(
      { error: "providerId / protocol / baseUrl 均为必填" },
      { status: 400 }
    );
  }

  // 从数据库读取 API Key（不信任客户端传来的密钥）
  const secret = await getProviderSecret(userId, providerId);
  if (!secret?.apiKey) {
    return NextResponse.json(
      { error: "未配置 API Key，请前往「设置 → 音乐生成模型」填写并保存" },
      { status: 400 }
    );
  }

  let result: MusicGenerateResult;
  try {
    result = await callMusicProvider(protocol, {
      prompt: prompt.trim(),
      modelId: modelId || "",
      baseUrl,
      apiKey: secret.apiKey,
      targetDuration: typeof targetDuration === "number" ? targetDuration : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  // 保存音频文件
  const bgmDir = path.join(uploadDir, "bgm");
  fs.mkdirSync(bgmDir, { recursive: true });

  const filename = `${randomUUID()}.${result.format}`;
  fs.writeFileSync(path.join(bgmDir, filename), Buffer.from(result.hexAudio, "hex"));

  const duration = result.durationMs > 0 ? Math.round(result.durationMs / 1000) : 30;

  return NextResponse.json({
    filePath: `./uploads/bgm/${filename}`,
    duration,
    name: `BGM - ${prompt.trim().slice(0, 20)}`,
  });
}
