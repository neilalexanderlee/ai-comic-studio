import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptPresets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { BUILT_IN_PRESETS } from "@/lib/ai/prompts/presets";

// GET: List built-in + user presets
export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);

  const userPresets = await db
    .select()
    .from(promptPresets)
    .where(eq(promptPresets.userId, userId));

  const builtIn = BUILT_IN_PRESETS.map((p) => ({ ...p, isBuiltIn: true }));
  const user = userPresets.map((p) => ({ ...p, isBuiltIn: false }));

  return NextResponse.json([...builtIn, ...user]);
}

// POST: Save current config as preset
export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request);
  const body = (await request.json()) as {
    name: string;
    promptKey: string;
    slots: Record<string, string>;
  };

  if (!body.name || !body.promptKey || !body.slots) {
    return NextResponse.json(
      { error: "name, promptKey, and slots are required" },
      { status: 400 }
    );
  }

  const [inserted] = await db
    .insert(promptPresets)
    .values({
      id: ulid(),
      name: body.name,
      userId,
      promptKey: body.promptKey,
      slots: body.slots,
    })
    .returning();

  return NextResponse.json(inserted, { status: 201 });
}
