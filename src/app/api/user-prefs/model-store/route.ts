import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";
import {
  getModelStorePrefs,
  upsertModelStorePrefs,
  type ModelStorePersistPayload,
} from "@/lib/user-client-prefs";

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(null);
  }
  if (!getAuthUserIdFromRequest(request)) {
    await reclaimLocalProjectsForUser(userId);
  }
  const data = await getModelStorePrefs(userId);
  return NextResponse.json(data);
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

  if (!getAuthUserIdFromRequest(request)) {
    await reclaimLocalProjectsForUser(userId);
  }
  await upsertModelStorePrefs(userId, body);
  return NextResponse.json({ ok: true });
}
