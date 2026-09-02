import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/api-guard";
import { saveArtifactAt } from "@/lib/storage/artifact-store";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const ALLOWED_AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
};

/**
 * POST /api/uploads/audio
 * 上传 BGM / 音效文件，保存到 ./uploads/bgm/，返回服务端相对路径。
 * Body: multipart/form-data, field name "file"
 */
export async function POST(request: NextRequest) {
  // 无鉴权的写盘接口 = 任何人都能往服务器塞文件
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  // 类型校验
  const ext = ALLOWED_AUDIO_TYPES[file.type] ??
    (file.name.match(/\.(mp3|wav|aac|m4a|ogg|flac)$/i)?.[0] ?? null);

  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported audio type: ${file.type}` },
      { status: 415 }
    );
  }

  const filename = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  // 配置了 OSS 就落 OSS，否则落本地；返回的引用两种形态 uploadUrl 都能解析
  const relativePath = await saveArtifactAt(path.join(uploadDir, "bgm"), filename, buffer);

  return NextResponse.json({ filePath: relativePath });
}
