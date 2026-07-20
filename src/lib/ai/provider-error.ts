export function upstreamHttpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export function mapUpstreamErrorHttpStatus(err: unknown): number {
  const status = upstreamHttpStatus(err);
  if (status === 429) return 429;
  const message = err instanceof Error ? err.message : String(err);
  if (/Jimeng .*(InvalidCredential|Invalid credential|InvalidAccessKey|SignatureDoesNotMatch)/i.test(message)) {
    return 401;
  }
  if (/Jimeng .*AccessDenied/i.test(message)) return 403;
  if (status !== undefined && status >= 500 && status < 600) return 502;
  return 500;
}

function parseJsonErrorMessage(message: string): string | null {
  try {
    const parsed = JSON.parse(message) as { error?: { message?: string } };
    return parsed?.error?.message ?? null;
  } catch {
    return null;
  }
}

function formatQuotaError(message: string): string {
  const model = message
    .match(/\bmodel:\s*([^\s,\n]+)/i)?.[1]
    ?.replace(/[。.;:]+$/, "");
  const modelLabel = model ? ` ${model}` : "";

  if (/\blimit:\s*0\b/i.test(message)) {
    return `Gemini 图片模型${modelLabel} 当前无可用配额（Google 返回 429，额度上限为 0）。请为该 API Key 所属项目启用结算或申请配额，或切换其他图片模型。`;
  }

  const retrySeconds = message.match(/retry in\s+([\d.]+)s/i)?.[1];
  const retryHint = retrySeconds
    ? `请约 ${Math.ceil(Number(retrySeconds))} 秒后重试，或切换其他图片模型。`
    : "请稍后重试，或切换其他图片模型。";
  return `Gemini 图片模型${modelLabel} 已触发配额或频率限制（Google 返回 429）。${retryHint}`;
}

export function extractProviderErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const status = upstreamHttpStatus(err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const requestId =
    typeof err === "object" && err !== null && "requestID" in err
      ? String((err as { requestID?: unknown }).requestID ?? "")
      : "";
  const requestIdHint = requestId ? `（请求 ID: ${requestId}）` : "";
  const parsedMessage = parseJsonErrorMessage(err.message);
  const upstreamMessage = parsedMessage ?? err.message;

  if (status === 429 || /RESOURCE_EXHAUSTED|quota exceeded/i.test(upstreamMessage)) {
    return formatQuotaError(upstreamMessage);
  }

  if (/Jimeng .*(InvalidCredential|Invalid credential|InvalidAccessKey|SignatureDoesNotMatch)/i.test(upstreamMessage)) {
    return "即梦鉴权失败：火山引擎拒绝了当前 Access Key ID / Secret Access Key。请到「设置 → Jimeng」重新粘贴同一条、未禁用的 IAM AK/SK（不是方舟 API Key），保存后重试。";
  }

  if (/Jimeng .*AccessDenied/i.test(upstreamMessage)) {
    return "即梦权限不足：当前火山引擎 IAM 用户没有调用即梦服务的权限，请为该用户添加对应权限后重试。";
  }

  if (status !== undefined && status >= 500) {
    if (code === "InternalServiceError" || status === 500) {
      return `图像服务暂时不可用（上游 ${status}），请稍后重试或更换图像模型。${requestIdHint}`;
    }
    return `上游服务错误 ${status}：${upstreamMessage}${requestIdHint}`;
  }

  return upstreamMessage;
}
