import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-guard";
import { allowUserProviders, isKeyOwner } from "@/lib/admin";
import { upsertProviderSecret } from "@/lib/provider-secrets";

export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const userId = guard.userId;

  // 平台模式（ALLOW_USER_PROVIDERS=0）下只有 owner 能写密钥。
  // 运营 admin 也挡在外面 —— 让他帮忙拉人不等于把上游密钥交给他。
  // 默认开，自部署 BYOK 行为一行不变。
  if (!allowUserProviders() && !(await isKeyOwner(userId))) {
    return NextResponse.json(
      { error: "本站的模型由平台统一配置，你的账号没有配置密钥的权限" },
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
