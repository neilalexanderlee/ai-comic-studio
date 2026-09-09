import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-guard";
import { allowUserProviders, isAdminUser } from "@/lib/admin";
import { upsertProviderSecret } from "@/lib/provider-secrets";

export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const userId = guard.userId;

  // 平台模式（ALLOW_USER_PROVIDERS=0）下非管理员不再自己配 Key，统一用平台 Key。
  // 默认开，自部署 BYOK 行为一行不变。
  if (!allowUserProviders() && !(await isAdminUser(userId))) {
    return NextResponse.json(
      { error: "本站由管理员统一配置模型，无需填写 API Key" },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as {
      providerId?: string;
      apiKey?: string;
      secretKey?: string;
    };
    const providerId = body.providerId?.trim();
    const apiKey = body.apiKey?.trim();

    if (!providerId) {
      return NextResponse.json({ error: "providerId is required" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    await upsertProviderSecret({
      userId,
      providerId,
      apiKey,
      secretKey: body.secretKey?.trim() || undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
