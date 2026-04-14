import { NextResponse } from "next/server";
import { getPromptDefinition } from "@/lib/ai/prompts/registry";

// POST: validate a full-text edit for locked slot content preservation
export async function POST(request: Request) {
  const body = (await request.json()) as {
    promptKey: string;
    content: string;
  };

  const { promptKey, content } = body;

  if (!promptKey) {
    return NextResponse.json(
      { error: "promptKey is required" },
      { status: 400 }
    );
  }

  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "content is required" },
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

  const warnings: string[] = [];

  // Check that locked slots' default content is still present in the edited text
  for (const slot of def.slots) {
    if (!slot.editable && slot.defaultContent) {
      if (!content.includes(slot.defaultContent)) {
        warnings.push(
          `Locked slot "${slot.key}" content has been modified or removed. This may cause unexpected behavior.`
        );
      }
    }
  }

  const valid = warnings.length === 0;

  return NextResponse.json({ valid, warnings });
}
