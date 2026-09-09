/**
 * GET /api/platform/providers
 *
 * 平台模式下，非管理员的客户端从这里拿**管理员配好的 provider 列表**
 * （脱敏：不含任何 Key）。没有它，普通用户的 model-store 是空的 ——
 * 他们既看不到能用哪些模型，也发不出带 providerId 的生成请求。
 *
 * Response:
 *   { managed: true,  payload: ModelStorePersistPayload }  平台模式且非管理员
 *   { managed: false, payload: null }                      自部署 / 管理员，各管各的
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-guard";
import { allowUserProviders, getPlatformKeyOwnerId, isKeyOwner } from "@/lib/admin";
import { getModelStorePrefs } from "@/lib/user-client-prefs";

export async function GET(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;

  // owner 看到的永远是自己那份（他就是平台配置的作者），不需要托管。
  // 运营 admin 走托管分支 —— 他不该看到任何 Key，包括 provider 列表里的配置入口。
  if (allowUserProviders() || (await isKeyOwner(guard.userId))) {
    return NextResponse.json({ managed: false, payload: null });
  }

  const ownerId = await getPlatformKeyOwnerId();
  if (!ownerId) return NextResponse.json({ managed: true, payload: null });

  const prefs = await getModelStorePrefs(ownerId);
  if (!prefs) return NextResponse.json({ managed: true, payload: null });

  // 脱敏：model_store_json 本身就不存密钥（密钥在 provider_secrets），
  // 这里再显式抹一次，避免以后有人往那份 JSON 里塞了 Key 而这里毫无防护。
  return NextResponse.json({
    managed: true,
    payload: {
      ...prefs,
      providers: (prefs.providers ?? []).map((p) => ({
        ...p,
        apiKey: "",
        secretKey: undefined,
      })),
    },
  });
}
