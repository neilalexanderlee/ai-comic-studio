"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  Film,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
  Wand2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedCharacter {
  name: string;
  aliases?: string[];
  frequency: number;
  description: string;
  visualHint?: string;
  scope?: string;
}

interface SplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  script?: string;
  characters?: string[];
}

type StepStatus = "idle" | "running" | "done" | "error";
type StepNum = 1 | 2 | 3 | 4 | 5;

interface StepState {
  status: StepStatus;
  message: string;
}

const STEP_META: {
  num: StepNum;
  icon: React.FC<{ className?: string }>;
  label: string;
  desc: string;
}[] = [
  { num: 1, icon: Wand2,    label: "扩写大纲",   desc: "AI 将大纲扩写为完整剧本" },
  { num: 2, icon: Users,    label: "提取角色",   desc: "解析角色定妆词与视觉描述" },
  { num: 3, icon: Layers,   label: "分集解析",   desc: "按剧集结构切分故事线" },
  { num: 4, icon: Sparkles, label: "写入数据库", desc: "创建剧集与角色记录" },
  { num: 5, icon: Film,     label: "生成分镜",   desc: "解析结构化分镜写入数据库" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AutoPipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const router = useRouter();
  const textGuard = useModelGuard("text");
  const getModelConfig = useModelStore((s) => s.getModelConfig);

  // Project / outline
  const [outline, setOutline] = useState<string>("");
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [projectLoaded, setProjectLoaded] = useState(false);

  // Pipeline state
  const [started, setStarted] = useState(false);
  const [steps, setSteps] = useState<Record<StepNum, StepState>>({
    1: { status: "idle", message: "" },
    2: { status: "idle", message: "" },
    3: { status: "idle", message: "" },
    4: { status: "idle", message: "" },
    5: { status: "idle", message: "" },
  });
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Step data
  const generatedScript = useRef<string>("");
  const [streamedChars, setStreamedChars] = useState(0);
  const characters = useRef<ExtractedCharacter[]>([]);
  const episodes = useRef<SplitEpisode[]>([]);
  const createdEpisodeIds = useRef<string[]>([]);

  // ── Load project ─────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch(`/api/projects/${projectId}`);
        const data = await res.json();
        setOutline(data.idea || "");
        setProjectTitle(data.title || "");
      } catch {
        toast.error("无法加载项目信息");
      } finally {
        setProjectLoaded(true);
      }
    }
    load();
  }, [projectId]);

  // ── Log helpers ──────────────────────────────────────────────────────────

  const pushLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const setStep = useCallback(
    (num: StepNum, status: StepStatus, message: string) => {
      setSteps((prev) => ({ ...prev, [num]: { status, message } }));
      if (message) pushLog(`[Step ${num}] ${message}`);
    },
    [pushLog]
  );

  // ── Pipeline steps ───────────────────────────────────────────────────────

  async function step1_expandOutline() {
    setStep(1, "running", "正在扩写大纲...");

    const modelConfig = getModelConfig();
    let script = "";
    let charCount = 0;

    try {
      const res = await apiFetch(`/api/projects/${projectId}/auto-pipeline/expand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline, modelConfig }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        script += chunk;
        charCount += chunk.length;
        setStreamedChars((prev) => prev + chunk.length);
      }

      generatedScript.current = script;
      setStep(1, "done", `扩写完成，共生成 ${charCount} 字`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "扩写失败";
      setStep(1, "error", `扩写失败: ${msg}`);
      throw err;
    }
  }

  async function step2_extractCharacters() {
    setStep(2, "running", "正在提取角色...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: generatedScript.current,
          modelConfig: getModelConfig(),
        }),
      });
      const data = await res.json();
      characters.current = data.characters;
      setStep(2, "done", `提取完成: ${data.characters.length} 个角色`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "提取失败";
      setStep(2, "error", `角色提取失败: ${msg}`);
      throw err;
    }
  }

  async function step3_splitEpisodes() {
    setStep(3, "running", "正在分集解析...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: generatedScript.current,
          allCharacters: characters.current.map((c) => ({ name: c.name, scope: c.scope })),
          modelConfig: getModelConfig(),
        }),
      });
      const data = await res.json();
      episodes.current = data.episodes;
      setStep(3, "done", `分集完成，共 ${data.episodes.length} 集`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "分集失败";
      setStep(3, "error", `分集失败: ${msg}`);
      throw err;
    }
  }

  async function step4_generate() {
    setStep(4, "running", `正在创建 ${episodes.current.length} 集和角色记录...`);

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodes: episodes.current,
          characters: characters.current,
        }),
      });
      const data = await res.json();
      createdEpisodeIds.current = (data.episodes as { id: string }[]).map((e) => e.id);
      setStep(
        4,
        "done",
        `导入完成！${data.characterCount} 个角色 · ${data.episodes.length} 集`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "创建失败";
      setStep(4, "error", `写入失败: ${msg}`);
      throw err;
    }
  }

  async function step5_generateStoryboard() {
    const episodeIds = createdEpisodeIds.current;
    if (!episodeIds.length) {
      setStep(5, "error", "没有可用的剧集 ID");
      throw new Error("No episode IDs");
    }
    setStep(5, "running", `正在解析 ${episodeIds.length} 集的分镜...`);

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/storyboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeIds }),
      });
      const data = await res.json() as { totalShots: number; successCount: number };
      setStep(
        5,
        "done",
        `分镜生成完成！${data.successCount}/${episodeIds.length} 集 · 共 ${data.totalShots} 个分镜`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "分镜生成失败";
      setStep(5, "error", `分镜生成失败: ${msg}`);
      throw err;
    }
  }

  // ── Start pipeline ───────────────────────────────────────────────────────

  async function startPipeline() {
    if (!outline.trim()) {
      toast.error("请先填写故事大纲");
      return;
    }
    if (!textGuard()) return;

    setStarted(true);
    setStreamedChars(0);
    setLogs([]);
    generatedScript.current = "";
    characters.current = [];
    episodes.current = [];
    createdEpisodeIds.current = [];

    // Clear old import logs
    try {
      await apiFetch(`/api/projects/${projectId}/import/logs`, { method: "DELETE" });
    } catch { /* ignore */ }

    try {
      await step1_expandOutline();
      await step2_extractCharacters();
      await step3_splitEpisodes();
      await step4_generate();
      await step5_generateStoryboard();

      toast.success("项目创建完成！正在跳转...");
      setTimeout(() => {
        router.push(`/${locale}/project/${projectId}/episodes`);
      }, 1500);
    } catch {
      // Error already set in the relevant step function
    }
  }

  // ── Retry ────────────────────────────────────────────────────────────────

  async function retryFromFailed() {
    if (!textGuard()) return;

    const failedStep = ([1, 2, 3, 4, 5] as StepNum[]).find(
      (s) => steps[s].status === "error"
    );
    if (!failedStep) return;

    // Reset failed step and all subsequent steps
    setSteps((prev) => {
      const next = { ...prev };
      for (let s = failedStep; s <= 5; s++) {
        next[s as StepNum] = { status: "idle", message: "" };
      }
      return next;
    });

    try {
      if (failedStep <= 1) {
        setStreamedChars(0);
        generatedScript.current = "";
        createdEpisodeIds.current = [];
        await step1_expandOutline();
        await step2_extractCharacters();
        await step3_splitEpisodes();
        await step4_generate();
        await step5_generateStoryboard();
      } else if (failedStep === 2) {
        characters.current = [];
        createdEpisodeIds.current = [];
        await step2_extractCharacters();
        await step3_splitEpisodes();
        await step4_generate();
        await step5_generateStoryboard();
      } else if (failedStep === 3) {
        episodes.current = [];
        createdEpisodeIds.current = [];
        await step3_splitEpisodes();
        await step4_generate();
        await step5_generateStoryboard();
      } else if (failedStep === 4) {
        createdEpisodeIds.current = [];
        await step4_generate();
        await step5_generateStoryboard();
      } else {
        await step5_generateStoryboard();
      }

      toast.success("项目创建完成！正在跳转...");
      setTimeout(() => {
        router.push(`/${locale}/project/${projectId}/episodes`);
      }, 1500);
    } catch { /* already set */ }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  const hasError = ([1, 2, 3, 4, 5] as StepNum[]).some(
    (s) => steps[s].status === "error"
  );
  const allDone = ([1, 2, 3, 4, 5] as StepNum[]).every(
    (s) => steps[s].status === "done"
  );

  const currentStep = ([1, 2, 3, 4, 5] as StepNum[]).find(
    (s) => steps[s].status === "running"
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-[--surface]">
      {/* Left sidebar */}
      <div className="flex w-64 shrink-0 flex-col border-r border-[--border-subtle] bg-white p-5">
        <button
          onClick={() => router.push(`/${locale}/project/${projectId}/episodes`)}
          className="mb-6 flex items-center gap-2 text-sm text-[--text-muted] hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回剧集列表
        </button>

        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Wand2 className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-bold text-[--text-primary]">
              AI 全自动创建
            </h2>
          </div>
          {projectTitle && (
            <p className="text-xs text-[--text-muted] truncate">{projectTitle}</p>
          )}
        </div>

        {/* Step indicators */}
        <div className="flex flex-col gap-2">
          {STEP_META.map(({ num, icon: Icon, label, desc }) => {
            const { status } = steps[num];
            const isCurrent = currentStep === num;

            return (
              <div
                key={num}
                className={`relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-300 ${
                  status === "running"
                    ? "border-primary/30 bg-primary/5"
                    : status === "done"
                    ? "border-transparent bg-emerald-50"
                    : status === "error"
                    ? "border-red-200 bg-red-50"
                    : "border-transparent bg-[--surface]"
                }`}
              >
                {/* Animated left bar when running */}
                {isCurrent && (
                  <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary animate-pulse" />
                )}

                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    status === "done"
                      ? "bg-emerald-100 text-emerald-600"
                      : status === "running"
                      ? "bg-primary/15 text-primary"
                      : status === "error"
                      ? "bg-red-100 text-red-500"
                      : "bg-white text-[--text-muted]"
                  }`}
                >
                  {status === "running" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : status === "done" ? (
                    <Check className="h-4 w-4" />
                  ) : status === "error" ? (
                    <XCircle className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-medium ${
                      status === "done"
                        ? "text-emerald-700"
                        : status === "running"
                        ? "text-primary"
                        : status === "error"
                        ? "text-red-600"
                        : "text-[--text-muted]"
                    }`}
                  >
                    {label}
                  </div>
                  <div className="text-[10px] text-[--text-muted] truncate">{desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Stats when running / done */}
        {started && (
          <div className="mt-auto pt-4 space-y-1.5 border-t border-[--border-subtle]">
            {streamedChars > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[--text-muted]">已生成</span>
                <span className="font-mono font-medium text-[--text-primary]">
                  {streamedChars.toLocaleString()} 字
                </span>
              </div>
            )}
            {steps[2].status === "done" && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[--text-muted]">角色数</span>
                <span className="font-mono font-medium text-[--text-primary]">
                  {characters.current.length}
                </span>
              </div>
            )}
            {steps[3].status === "done" && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[--text-muted]">剧集数</span>
                <span className="font-mono font-medium text-[--text-primary]">
                  {episodes.current.length}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!started ? (
          /* ── Pre-start: show outline + start button ── */
          <div className="flex flex-1 flex-col items-center justify-center p-8">
            <div className="w-full max-w-2xl space-y-6">
              {/* Header */}
              <div className="text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5">
                  <Wand2 className="h-7 w-7 text-primary" />
                </div>
                <h1 className="font-display text-2xl font-bold text-[--text-primary]">
                  AI 全自动生成项目
                </h1>
                <p className="mt-1.5 text-sm text-[--text-muted]">
                  系统将根据下方大纲，自动生成完整剧本、提取角色、分集，并写入数据库
                </p>
              </div>

              {/* Outline preview */}
              <div className="rounded-2xl border border-[--border-subtle] bg-white p-5">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[--text-muted]" />
                  <span className="text-sm font-medium text-[--text-secondary]">
                    故事大纲
                  </span>
                  <span className="ml-auto text-xs text-[--text-muted]">
                    {outline.length} 字
                  </span>
                </div>
                {!projectLoaded ? (
                  <div className="flex items-center gap-2 text-sm text-[--text-muted]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中...
                  </div>
                ) : outline ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[--text-primary] line-clamp-8">
                    {outline}
                  </p>
                ) : (
                  <p className="text-sm text-[--text-muted] italic">
                    未找到故事大纲。请返回首页重新创建项目并填写大纲。
                  </p>
                )}
              </div>

              {/* Pipeline preview */}
              <div className="flex items-center justify-center gap-2 text-xs text-[--text-muted]">
                {STEP_META.map(({ num, label }, i) => (
                  <div key={num} className="flex items-center gap-2">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary font-medium">
                      {label}
                    </span>
                    {i < STEP_META.length - 1 && (
                      <ChevronRight className="h-3.5 w-3.5 text-[--text-muted]" />
                    )}
                  </div>
                ))}
              </div>

              {/* Start button */}
              <Button
                onClick={startPipeline}
                disabled={!outline.trim() || !projectLoaded}
                className="w-full rounded-xl"
                size="lg"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                开始全自动生成
              </Button>
            </div>
          </div>
        ) : (
          /* ── In progress / done ── */
          <div className="flex flex-1 flex-col overflow-hidden p-6 gap-4">
            {/* Current step banner */}
            <div
              className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-all ${
                allDone
                  ? "border-emerald-200 bg-emerald-50"
                  : hasError
                  ? "border-red-200 bg-red-50"
                  : "border-primary/20 bg-primary/5"
              }`}
            >
              {allDone ? (
                <Check className="h-5 w-5 text-emerald-600" />
              ) : hasError ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
              )}
              <div>
                <div
                  className={`text-sm font-semibold ${
                    allDone
                      ? "text-emerald-700"
                      : hasError
                      ? "text-red-600"
                      : "text-primary"
                  }`}
                >
                  {allDone
                    ? "全部完成！正在跳转到剧集页面..."
                    : hasError
                    ? "出现错误，可点击「重试」从失败步骤继续"
                    : currentStep
                    ? `正在执行：${STEP_META[currentStep - 1].label}`
                    : "准备中..."}
                </div>
                {currentStep && !allDone && !hasError && (
                  <div className="text-xs text-[--text-muted]">
                    {steps[currentStep].message}
                  </div>
                )}
              </div>
              {hasError && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={retryFromFailed}
                  className="ml-auto shrink-0"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  重试
                </Button>
              )}
            </div>

            {/* Live script streaming (step 1) */}
            {steps[1].status === "running" && (
              <div className="rounded-xl border border-[--border-subtle] bg-white flex-1 overflow-hidden flex flex-col min-h-0">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[--border-subtle] shrink-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-[--text-secondary]">
                    <Wand2 className="h-4 w-4 text-primary" />
                    实时生成预览
                  </div>
                  <span className="font-mono text-xs text-primary">
                    {streamedChars.toLocaleString()} 字
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-[--text-secondary] whitespace-pre-wrap">
                  {/* We don't store the streaming text in state for perf — just show char count */}
                  <div className="flex items-center gap-2 text-[--text-muted]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在生成剧本内容...（{streamedChars.toLocaleString()} 字已生成）
                  </div>
                </div>
              </div>
            )}

            {/* Log panel */}
            {(steps[1].status !== "running" || logs.length > 0) && (
              <div className="rounded-xl border border-[--border-subtle] bg-white overflow-hidden flex flex-col min-h-0 flex-1">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[--border-subtle] shrink-0">
                  <FileText className="h-3.5 w-3.5 text-[--text-muted]" />
                  <span className="text-sm font-medium text-[--text-secondary]">执行日志</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 max-h-[50vh]">
                  <div className="space-y-1.5 font-mono text-xs">
                    {logs.map((log, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span className="text-[--text-primary]">{log}</span>
                      </div>
                    ))}

                    {/* Show step completion messages */}
                    {([1, 2, 3, 4, 5] as StepNum[]).map((num) => {
                      const { status, message } = steps[num];
                      if (status === "done" || status === "error") {
                        return (
                          <div key={`done-${num}`} className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                                status === "done" ? "bg-emerald-500" : "bg-red-500"
                              }`}
                            />
                            <span
                              className={
                                status === "error" ? "text-red-500" : "text-[--text-primary]"
                              }
                            >
                              [Step {num}] {message}
                            </span>
                          </div>
                        );
                      }
                      return null;
                    })}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </div>
            )}

            {/* Character preview after step 2 */}
            {steps[2].status === "done" && characters.current.length > 0 && (
              <div className="shrink-0">
                <div className="mb-2 text-xs font-medium text-[--text-secondary]">
                  已提取角色（{characters.current.length}）
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {characters.current.slice(0, 20).map((char) => (
                    <span
                      key={char.name}
                      className="rounded-full px-2.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600"
                    >
                      {char.name}
                    </span>
                  ))}
                  {characters.current.length > 20 && (
                    <span className="rounded-full px-2.5 py-0.5 text-[10px] text-[--text-muted]">
                      +{characters.current.length - 20} 更多
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
