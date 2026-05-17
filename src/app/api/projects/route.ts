import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getAuthUserIdFromRequest } from "@/lib/auth";
import { reclaimLocalProjectsForUser } from "@/lib/reclaim-local-user";

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);
  // Only reclaim for anonymous (unauthenticated) users.
  // For logged-in users, migrate-data handles this at login time.
  // Running reclaim for auth users with 0 projects would steal their other data.
  if (!getAuthUserIdFromRequest(request)) {
    await reclaimLocalProjectsForUser(userId);
  }
  const allProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
  return NextResponse.json(allProjects);
}

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request);
  const body = (await request.json()) as { title: string; script?: string; idea?: string };
  const id = ulid();

  const [project] = await db
    .insert(projects)
    .values({
      id,
      userId,
      title: body.title,
      script: body.script || "",
      idea: body.idea || "",
    })
    .returning();

  return NextResponse.json(project, { status: 201 });
}
