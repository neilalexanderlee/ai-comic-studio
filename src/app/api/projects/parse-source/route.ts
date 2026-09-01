import { NextResponse } from "next/server";
import { extractTextFromFile } from "@/lib/import-utils";
import { requireUser } from "@/lib/api-guard";

export const maxDuration = 60;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function POST(request: Request) {
  // 无鉴权的文件解析接口会被当作免费的算力/内存消耗入口
  const guard = requireUser(request);
  if (!guard.ok) return guard.response;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "文件不能超过 20MB" }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractTextFromFile(buffer, file.name);
    if (!text.trim()) {
      return NextResponse.json({ error: "文件内容为空" }, { status: 400 });
    }
    return NextResponse.json({ text, charCount: text.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "文件解析失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
