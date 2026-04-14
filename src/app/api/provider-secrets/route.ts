import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { upsertProviderSecret } from "@/lib/provider-secrets";

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
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
