import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { deleteProviderSecret, getProviderSecret } from "@/lib/provider-secrets";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
  }

  const { providerId } = await params;
  const secret = await getProviderSecret(userId, providerId);
  return NextResponse.json({
    hasSecret: !!secret?.apiKey,
    apiKey: secret?.apiKey ?? "",
    secretKey: secret?.secretKey ?? "",
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
  }

  const { providerId } = await params;
  await deleteProviderSecret(userId, providerId);
  return NextResponse.json({ ok: true });
}
