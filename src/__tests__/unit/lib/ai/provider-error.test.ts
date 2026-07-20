import { describe, expect, it } from "vitest";
import {
  extractProviderErrorMessage,
  mapUpstreamErrorHttpStatus,
} from "@/lib/ai/provider-error";

function apiError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe("provider error handling", () => {
  it("maps Gemini zero quota to HTTP 429 and an actionable message", () => {
    const error = apiError(429, JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded, limit: 0, model: gemini-3.1-flash-image. Please retry in 30.18s.",
      },
    }));

    expect(mapUpstreamErrorHttpStatus(error)).toBe(429);
    expect(extractProviderErrorMessage(error)).toBe(
      "Gemini 图片模型 gemini-3.1-flash-image 当前无可用配额（Google 返回 429，额度上限为 0）。请为该 API Key 所属项目启用结算或申请配额，或切换其他图片模型。"
    );
  });

  it("shows the retry delay for a temporary rate limit", () => {
    const error = apiError(
      429,
      "Quota exceeded for model: gemini-3.1-flash-image, please retry in 30.18s"
    );

    expect(extractProviderErrorMessage(error)).toContain("约 31 秒后重试");
  });

  it("maps upstream 5xx errors to 502", () => {
    expect(mapUpstreamErrorHttpStatus(apiError(503, "unavailable"))).toBe(502);
  });

  it("maps Jimeng invalid credentials to HTTP 401 with setup guidance", () => {
    const error = new Error(
      "Jimeng Image SDK request failed: Jimeng Image submit error [InvalidCredential]: Invalid credential in 'Authorization'"
    );

    expect(mapUpstreamErrorHttpStatus(error)).toBe(401);
    expect(extractProviderErrorMessage(error)).toContain("同一条、未禁用的 IAM AK/SK");
    expect(extractProviderErrorMessage(error)).not.toContain("Authorization");
  });
});
