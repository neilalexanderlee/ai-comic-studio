import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Service } from "@volcengine/openapi";
import { bootstrap } from "@/lib/bootstrap";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getProviderSecret, resolveTrustedEndpoint } from "@/lib/provider-secrets";
import { openBillingGate } from "@/lib/billing/gate";
import { saveArtifact } from "@/lib/storage/artifact-store";

/** 火山「生成纯音乐」单段时长硬限制（官方约束，超出会被接口拒绝） */
export const VOLC_MUSIC_MIN_DURATION = 30;
export const VOLC_MUSIC_MAX_DURATION = 120;

interface MusicGenerateParams {
  prompt: string;
  /** 对应 provider 的 modelId，这里用作火山音乐的 Version 字段（如 "v5.0"） */
  modelId: string;
  baseUrl: string;
  /** 火山 IAM Access Key ID */
  accessKeyId: string;
  /** 火山 IAM Secret Access Key */
  secretAccessKey: string;
  /** 目标时长（秒），会被 clamp 到 [30, 120] */
  targetDuration?: number;
}

interface MusicGenerateResult {
  /** 上游返回的音频下载地址（CDN，24 小时有效） */
  audioUrl: string;
  /** 实际生成时长（秒） */
  durationSec: number;
  format: string;
}

interface VolcApiResponse<T> {
  ResponseMetadata?: {
    RequestId?: string;
    Error?: { Code?: string; Message?: string; CodeN?: number };
  };
  Result?: T;
}

function assertNoVolcError(response: VolcApiResponse<unknown>, action: string) {
  const err = response?.ResponseMetadata?.Error;
  if (err) {
    throw new Error(`豆包音乐 ${action} 失败：${err.Message ?? err.Code ?? "未知错误"}`);
  }
}

// ── 各协议实现 ────────────────────────────────────────────────────────────────

/**
 * 豆包音乐 / 火山「AI 生成音乐大模型 · 生成纯音乐」
 *
 * 控制台：https://console.volcengine.com/ai-music
 * 认证：AK/SK 签名（IAM 子用户需挂 ImaginationFullAccess），**不是** 方舟的 Bearer API Key。
 * 网关：open.volcengineapi.com，serviceName=imagination，Version=2024-08-12
 *
 *   提交  Action=GenBGMForTime
 *         body { Text: 中文曲风描述, Duration: 30–120 整数秒, Version: "v5.0", EnableInputRewrite: false }
 *         → Result.TaskID
 *   查询  Action=QuerySong
 *         body { TaskID } → Result.Status === 2 时取 Result.SongDetail.AudioUrl
 *
 * 输出为 wav（抖音 CDN，24 小时有效，必须及时下载转存）。计费后付费 ¥0.002/秒。
 *
 * 注意：官方未公开完整的 Status 枚举，这里只把 2 认定为成功，其余状态继续轮询，
 * 真正的失败靠 ResponseMetadata.Error 和超时兜底。
 */
async function generateWithVolcMusic(params: MusicGenerateParams): Promise<MusicGenerateResult> {
  const { prompt, modelId, baseUrl, accessKeyId, secretAccessKey, targetDuration } = params;

  const host = (baseUrl || "https://open.volcengineapi.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  // 火山音乐只接受 [30, 120] 的整数秒。选区不足 30s 时按 30s 生成，前端 clip 自行截取。
  const duration = Math.min(
    VOLC_MUSIC_MAX_DURATION,
    Math.max(VOLC_MUSIC_MIN_DURATION, Math.round(targetDuration ?? VOLC_MUSIC_MIN_DURATION))
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new (Service as any)({
    serviceName: "imagination",
    defaultVersion: "2024-08-12",
    host,
    region: "cn-beijing",
  });
  svc.setAccessKeyId(accessKeyId);
  svc.setSecretKey(secretAccessKey);

  const callSubmit = svc.createJSONAPI("GenBGMForTime", { Version: "2024-08-12" });
  const callQuery = svc.createJSONAPI("QuerySong", { Version: "2024-08-12" });

  const submitRes = (await callSubmit({
    Text: prompt,
    Duration: duration,
    Version: modelId || "v5.0",
    EnableInputRewrite: false,
  })) as VolcApiResponse<{ TaskID?: string }>;
  assertNoVolcError(submitRes, "GenBGMForTime");

  const taskId = submitRes?.Result?.TaskID;
  if (!taskId) throw new Error("豆包音乐未返回 TaskID");

  // 轮询：3s 间隔，最多 100 次（约 5 分钟）
  const maxAttempts = 100;
  const intervalMs = 3_000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const queryRes = (await callQuery({ TaskID: taskId })) as VolcApiResponse<{
      Status?: number;
      SongDetail?: { AudioUrl?: string };
    }>;
    assertNoVolcError(queryRes, "QuerySong");

    if (queryRes?.Result?.Status === 2) {
      const audioUrl = queryRes.Result.SongDetail?.AudioUrl;
      if (!audioUrl) throw new Error("豆包音乐任务完成但未返回 AudioUrl");
      return { audioUrl, durationSec: duration, format: "wav" };
    }
  }

  throw new Error(`豆包音乐生成超时（TaskID ${taskId}，已等待 ${(maxAttempts * intervalMs) / 1000} 秒）`);
}

// ── 协议路由 ──────────────────────────────────────────────────────────────────

async function callMusicProvider(
  protocol: string,
  params: MusicGenerateParams
): Promise<MusicGenerateResult> {
  switch (protocol) {
    case "volc-music":
      return generateWithVolcMusic(params);
    default:
      throw new Error(`不支持的音乐生成协议: ${protocol}`);
  }
}

// ── 音频下载 ──────────────────────────────────────────────────────────────────

/** 下载上游 CDN 音频（链接 24h 过期，必须立刻转存），返回内容交由存储层落地。 */
async function downloadAudioWithRetry(
  audioUrl: string,
  attempts = 3,
  delayMs = 2_000
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) throw new Error("download failed: empty response body");
      return buffer;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[BgmDownload] Attempt ${attempt}/${attempts} failed: ${message}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`BGM 音频下载失败（重试 ${attempts} 次）：${message}`);
}

// ── Route Handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/bgm/generate
 * 调用已配置的音乐生成 provider，生成纯器乐 BGM，落盘后返回 filePath + duration。
 *
 * Body: {
 *   prompt: string;
 *   providerId: string;
 *   protocol: string;    // "volc-music"
 *   baseUrl: string;     // provider 配置的网关地址
 *   modelId?: string;    // 火山音乐用作 Version（如 "v5.0"）
 *   targetDuration?: number;
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

  const { prompt, providerId, modelId, targetDuration } = body;

  if (!prompt?.trim()) {
    return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
  }
  if (!providerId) {
    return NextResponse.json({ error: "providerId 为必填" }, { status: 400 });
  }

  // 协议与地址一律以服务端存的 provider 记录为准，请求体里的同名字段不作数 ——
  // 否则就是「密钥从服务端取、地址听客户端的」，把 baseUrl 换成自己的服务器即可收走密钥。
  // 详见 lib/provider-endpoint.ts。
  const endpoint = await resolveTrustedEndpoint(userId, providerId);
  if (!endpoint) {
    return NextResponse.json(
      { error: "该 provider 未在设置里配置服务地址，请先在「设置 → 模型」保存一次" },
      { status: 400 }
    );
  }
  const { protocol, baseUrl } = endpoint;

  // 从数据库读取密钥（不信任客户端传来的密钥）。火山音乐走 AK/SK，两者都必需。
  const secret = await getProviderSecret(userId, providerId);
  if (!secret?.apiKey || !secret?.secretKey) {
    return NextResponse.json(
      {
        error:
          "未配置 AK/SK，请前往「设置 → 音乐生成模型」填写火山引擎 Access Key ID 与 Secret Access Key 并保存",
      },
      { status: 400 }
    );
  }

  // 计费闸门（BILLING_ENABLED=1 时生效，否则空操作）。必须在调用上游前预扣。
  const billing = await openBillingGate(userId, {
    kind: "music",
    modelId: modelId || "",
    durationSeconds: typeof targetDuration === "number" ? targetDuration : undefined,
  }, { protocol });
  if (!billing.ok) return billing.response;

  let result: MusicGenerateResult;
  try {
    result = await callMusicProvider(protocol, {
      prompt: prompt.trim(),
      modelId: modelId || "",
      baseUrl,
      accessKeyId: secret.apiKey,
      secretAccessKey: secret.secretKey,
      targetDuration: typeof targetDuration === "number" ? targetDuration : undefined,
    });
  } catch (err) {
    await billing.refund(err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  // 保存音频：配置了 OSS 就走 OSS，否则落本地磁盘（行为与改造前一致）
  const filename = `${randomUUID()}.${result.format}`;
  let filePath: string;
  try {
    const audio = await downloadAudioWithRetry(result.audioUrl);
    filePath = await saveArtifact(`bgm/${filename}`, audio);
  } catch (err) {
    // 上游已生成（钱已花），但我们没拿到文件。仍然退还用户积分——
    // 这笔损失由平台承担，不该让用户为拿不到的产物付费。
    await billing.refund(err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  await billing.settle();

  return NextResponse.json({
    filePath,
    duration: result.durationSec,
    name: `BGM - ${prompt.trim().slice(0, 20)}`,
    ...(billing.credits > 0 && { creditsCharged: billing.credits }),
  });
}
