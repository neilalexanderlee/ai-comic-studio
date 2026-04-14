import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { promptTemplates } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

// GET: list all global overrides for user
export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);

  const templates = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.scope, "global"),
        isNull(promptTemplates.projectId)
      )
    );

  return NextResponse.json(templates);
}
