import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import {
  deleteArkAssetLibraryCredentials,
  getArkAssetLibraryCredentials,
  upsertArkAssetLibraryCredentials,
} from "@/lib/ark-asset-library-credentials";

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
  }

  const record = await getArkAssetLibraryCredentials(userId);
  return NextResponse.json({
    hasCredentials: !!record?.accessKeyId,
    accessKeyId: record?.accessKeyId ?? "",
    // secretAccessKey 不回传给前端，仅用「已配置」状态展示
    projectName: record?.projectName ?? "default",
    region: record?.region ?? "cn-beijing",
  });
}

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      accessKeyId?: string;
      secretAccessKey?: string;
      projectName?: string;
      region?: string;
    };
    const accessKeyId = body.accessKeyId?.trim();
    const secretAccessKey = body.secretAccessKey?.trim();

    if (!accessKeyId) {
      return NextResponse.json({ error: "accessKeyId is required" }, { status: 400 });
    }
    if (!secretAccessKey) {
      return NextResponse.json({ error: "secretAccessKey is required" }, { status: 400 });
    }

    await upsertArkAssetLibraryCredentials({
      userId,
      accessKeyId,
      secretAccessKey,
      projectName: body.projectName?.trim() || undefined,
      region: body.region?.trim() || undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 401 });
  }

  await deleteArkAssetLibraryCredentials(userId);
  return NextResponse.json({ ok: true });
}
