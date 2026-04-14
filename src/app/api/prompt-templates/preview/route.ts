import { NextResponse } from "next/server";
import {
  getPromptDefinition,
  getDefaultSlotContents,
} from "@/lib/ai/prompts/registry";

// POST: preview assembled prompt from given slots
export async function POST(request: Request) {
  const body = (await request.json()) as {
    promptKey: string;
    slots?: Record<string, string>;
  };

  const { promptKey, slots = {} } = body;

  if (!promptKey) {
    return NextResponse.json(
      { error: "promptKey is required" },
      { status: 400 }
    );
  }

  const def = getPromptDefinition(promptKey);
  if (!def) {
    return NextResponse.json(
      { error: `Unknown prompt key: ${promptKey}` },
      { status: 404 }
    );
  }

  // Merge provided slots with defaults
  const defaultContents = getDefaultSlotContents(promptKey) ?? {};
  const mergedSlots: Record<string, string> = { ...defaultContents, ...slots };

  // Build the full prompt
  const fullPrompt = def.buildFullPrompt(mergedSlots);

  // Compute highlights: track which slots were overridden vs default
  const highlights: Record<string, "overridden" | "default"> = {};
  for (const slot of def.slots) {
    if (slots[slot.key] !== undefined && slots[slot.key] !== slot.defaultContent) {
      highlights[slot.key] = "overridden";
    } else {
      highlights[slot.key] = "default";
    }
  }

  return NextResponse.json({ fullPrompt, highlights });
}
