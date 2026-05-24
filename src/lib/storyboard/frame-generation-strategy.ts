/**
 * Intelligent frame generation strategy.
 *
 * Decides whether to generate BOTH first + last frame (keyframe-interpolation mode)
 * or FIRST FRAME ONLY (reference-image mode) for a given shot.
 *
 * Strategy layers:
 *   1. Deterministic fast-path  — cheap, no LLM, handles clear-cut cases
 *   2. LLM semantic judgment    — for ambiguous cases; language-agnostic structured prompt
 *   3. Safe fallback            — if LLM errors/times out, default to "both"
 *
 * The deterministic layer covers ~60-70% of shots without any LLM cost.
 * The LLM layer fires only for named-character shots where the right answer is unclear.
 */

import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import {
  buildFrameStrategyPrompt,
  type FrameStrategyInput,
  type FrameStrategyResult,
} from "@/lib/ai/prompts/frame-strategy-judge";

export type FrameGenerationMode = "both" | "first_only";

export interface FrameModeDecision {
  mode: FrameGenerationMode;
  source: "deterministic" | "llm" | "fallback";
  reason: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the frame generation mode for a single shot.
 *
 * @param shot         Shot metadata (duration, camera, frame descs, prompt)
 * @param hasChars     Whether the shot contains named characters (from filterShotCharacters)
 * @param textConfig   Optional text model config — when provided, enables LLM semantic judgment
 */
export async function resolveFrameMode(
  shot: FrameStrategyInput & { duration: number | null },
  hasChars: boolean,
  textConfig?: ProviderConfig | null
): Promise<FrameModeDecision> {
  // ── Layer 1: Deterministic fast-path ──────────────────────────────────────
  const deterministic = deterministicCheck(shot, hasChars);
  if (deterministic) return deterministic;

  // ── Layer 2: LLM semantic judgment ────────────────────────────────────────
  if (textConfig) {
    try {
      const result = await llmJudge(shot, textConfig);
      console.log(
        `[FrameStrategy] LLM decision: ${result.mode} — ${result.reason}`
      );
      return { mode: result.mode, source: "llm", reason: result.reason };
    } catch (err) {
      console.warn(
        `[FrameStrategy] LLM judge failed, falling back to "both":`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // ── Layer 3: Safe fallback ────────────────────────────────────────────────
  return {
    mode: "both",
    source: "fallback",
    reason: "no text model configured or LLM judge failed — defaulting to both frames",
  };
}

// ---------------------------------------------------------------------------
// Layer 1: Deterministic checks
// ---------------------------------------------------------------------------

function deterministicCheck(
  shot: FrameStrategyInput & { duration: number | null },
  hasChars: boolean
): FrameModeDecision | null {
  const duration = shot.duration ?? 10;

  // No named characters → crowd / environment shot
  if (!hasChars) {
    return {
      mode: "first_only",
      source: "deterministic",
      reason: "no named characters — crowd/environment shot, skip last frame",
    };
  }

  // Very short shot — interpolation has no room to breathe
  if (duration < 5) {
    return {
      mode: "first_only",
      source: "deterministic",
      reason: `duration ${duration}s < 5s — too short for useful last-frame interpolation`,
    };
  }

  // No end frame description at all — nothing to anchor
  if (!shot.endFrameDesc || shot.endFrameDesc.trim() === "") {
    return {
      mode: "first_only",
      source: "deterministic",
      reason: "endFrameDesc is absent — no end state to anchor; use reference mode",
    };
  }

  // endFrameDesc is effectively the same as startFrameDesc (near-static shot)
  if (
    shot.startFrameDesc &&
    textSimilarity(shot.startFrameDesc, shot.endFrameDesc) > 0.82
  ) {
    return {
      mode: "first_only",
      source: "deterministic",
      reason:
        "start and end frame descriptions are nearly identical — generating both would produce a near-static video",
    };
  }

  // Ambiguous — escalate to LLM
  return null;
}

// ---------------------------------------------------------------------------
// Layer 2: LLM semantic judge
// ---------------------------------------------------------------------------

async function llmJudge(
  shot: FrameStrategyInput,
  textConfig: ProviderConfig
): Promise<FrameStrategyResult> {
  const model = createLanguageModel(textConfig);
  const prompt = buildFrameStrategyPrompt(shot);

  const { text } = await generateText({
    model,
    prompt,
  });

  const parsed = JSON.parse(extractJSON(text)) as Partial<FrameStrategyResult>;

  if (parsed.mode !== "both" && parsed.mode !== "first_only") {
    throw new Error(`Unexpected mode value from LLM: ${parsed.mode}`);
  }

  return {
    mode: parsed.mode,
    reason: parsed.reason ?? "(no reason provided)",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lightweight token-overlap similarity score (0–1).
 * Deliberately simple — no regex, no language dependency.
 * Works on any language because it operates on whitespace-split tokens.
 */
function textSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/\s+/).filter((t) => t.length > 1));

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  // Jaccard coefficient
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}
