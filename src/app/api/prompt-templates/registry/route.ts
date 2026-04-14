import { NextResponse } from "next/server";
import { PROMPT_REGISTRY } from "@/lib/ai/prompts/registry";

export async function GET() {
  const registry = PROMPT_REGISTRY.map((def) => ({
    key: def.key,
    nameKey: def.nameKey,
    descriptionKey: def.descriptionKey,
    category: def.category,
    slots: def.slots.map((s) => ({
      key: s.key,
      nameKey: s.nameKey,
      descriptionKey: s.descriptionKey,
      defaultContent: s.defaultContent,
      editable: s.editable,
    })),
  }));
  return NextResponse.json(registry);
}
