/**
 * `GET / PUT /api/user-prefs/model-store` —— 当前用户那份 model-store 备份。
 *
 * 响应刻意是一个**信封**（`{ userId, updatedAt, payload }`）而不是裸 payload：
 *
 * · `userId` —— 客户端拿它判断「localStorage 里这份是不是上一个账号留下的」。
 *   zustand persist 的 key 是固定的 `"model-store"`、**不带 userId**，
 *   同一台浏览器换账号时上一个人的 provider 列表会直接出现在下一个人的设置页。
 *   所以哪怕没有数据也要把 userId 返回去 —— 「新账号还没配过」正是最需要
 *   把本地那份丢掉的时刻。
 * · `updatedAt` —— 服务端时钟的版本号，客户端据此判断「服务端那份比我新吗」。
 *   原来的逻辑是「本地为空才采用服务端那份」，于是 owner 在 A 电脑改完列表，
 *   B 电脑上那份旧的永远不更新，还会被写回去把 A 的改动盖掉。
 */
import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import {
  getModelStoreRecord,
  upsertModelStorePrefs,
  type ModelStorePersistPayload,
} from "@/lib/user-client-prefs";
import type { ModelStoreEnvelope } from "@/lib/model-store-envelope";

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ userId: null, updatedAt: null, payload: null } satisfies ModelStoreEnvelope);
  }
  const record = await getModelStoreRecord(userId);
  return NextResponse.json({
    userId,
    updatedAt: record?.updatedAt ?? null,
    payload: record?.payload ?? null,
  } satisfies ModelStoreEnvelope);
}

export async function PUT(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
  }

  const body = (await request.json()) as ModelStorePersistPayload;
  if (!body || !Array.isArray(body.providers)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // 只存 payload 本身 —— 信封字段不写进 model_store_json，
  // 否则 `updatedAt` 会被当成数据存进去，下次读出来又被当成版本号，自我污染。
  const updatedAt = await upsertModelStorePrefs(userId, {
    providers: body.providers,
    defaultTextModel: body.defaultTextModel ?? null,
    defaultImageModel: body.defaultImageModel ?? null,
    defaultVideoModel: body.defaultVideoModel ?? null,
    defaultMusicModel: body.defaultMusicModel ?? null,
  });
  return NextResponse.json({ ok: true, userId, updatedAt });
}
