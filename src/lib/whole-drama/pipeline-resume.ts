export type WholeDramaSource = "idea" | "novel" | "script";

export interface WholeDramaCharacter {
  name: string;
  aliases?: string[];
  frequency: number;
  description: string;
  visualHint?: string;
  voiceHint?: string;
  scope?: string;
}

export interface WholeDramaEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  script?: string;
  characters?: string[];
}

export interface WholeDramaImportLog {
  step: number;
  status: "running" | "done" | "error";
  message: string;
  metadata?: Record<string, unknown> | null;
}

export interface WholeDramaSnapshot {
  hasInit: boolean;
  script: string;
  step1Done: boolean;
  characters: WholeDramaCharacter[];
  step2Done: boolean;
  episodes: WholeDramaEpisode[];
  step3Done: boolean;
  step4Done: boolean;
}

export interface WholeDramaResumeState {
  sourceType: WholeDramaSource;
  sourceText: string;
  snapshot: WholeDramaSnapshot;
}

function isSource(value: unknown): value is WholeDramaSource {
  return value === "idea" || value === "novel" || value === "script";
}

export function resolveWholeDramaResume(
  project: { idea?: string | null; script?: string | null },
  logs: WholeDramaImportLog[],
  requestedSource?: string | null
): WholeDramaResumeState {
  const reversed = [...logs].reverse();
  const initLog = reversed.find(
    (log) => log.step === 0 && log.metadata?.phase === "whole_drama_init"
  );
  const persistedSource = initLog?.metadata?.sourceType;
  const sourceType: WholeDramaSource = isSource(requestedSource)
    ? requestedSource
    : isSource(persistedSource)
    ? persistedSource
    : "idea";

  // 文件解析也记录为 step 1，但只有 source_transform 才代表小说/故事已完成改编。
  const transformed = reversed.find(
    (log) =>
      log.step === 1 &&
      log.status === "done" &&
      log.metadata?.phase === "source_transform"
  );
  const characterLog = reversed.find(
    (log) => log.step === 2 && log.status === "done" && Array.isArray(log.metadata?.characters)
  );
  const episodeLog = reversed.find(
    (log) => log.step === 3 && log.status === "done" && Array.isArray(log.metadata?.episodes)
  );
  const script = project.script || "";
  const step1Done = sourceType === "script" ? Boolean(script.trim()) : Boolean(transformed && script.trim());

  return {
    sourceType,
    sourceText: sourceType === "idea" ? project.idea || "" : script,
    snapshot: {
      hasInit: Boolean(initLog),
      script,
      step1Done,
      characters: (characterLog?.metadata?.characters as WholeDramaCharacter[] | undefined) ?? [],
      step2Done: Boolean(characterLog),
      episodes: (episodeLog?.metadata?.episodes as WholeDramaEpisode[] | undefined) ?? [],
      step3Done: Boolean(episodeLog),
      step4Done: logs.some((log) => log.step === 4 && log.status === "done"),
    },
  };
}
