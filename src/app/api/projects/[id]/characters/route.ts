import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const result = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));
  return NextResponse.json(result);
}
