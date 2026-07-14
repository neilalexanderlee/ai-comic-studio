"use client";

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { BookOpen, FilePenLine, FileText, Lightbulb, Loader2, Plus, Sparkles, Upload, Wand2, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { validateWholeDramaSourceLength } from "@/lib/whole-drama/limits";
import { VISUAL_STYLE_PRESETS } from "@/lib/ai/prompts/visual-style-presets";
import { Palette } from "lucide-react";

type Mode = "blank" | "whole";
type WholeDramaSource = "idea" | "novel" | "script";

const DEFAULT_VISUAL_STYLE = "anime_2d";

const ACCEPTED_SOURCE_FILES = ".txt,.md,.markdown,.docx,.pdf";
const MAX_SOURCE_FILE_SIZE = 20 * 1024 * 1024;

const WHOLE_DRAMA_SOURCES = [
  {
    value: "idea" as const,
    icon: Lightbulb,
    label: "故事想法",
    desc: "从灵感规划整剧",
  },
  {
    value: "novel" as const,
    icon: BookOpen,
    label: "小说改编",
    desc: "保留主线转为漫剧",
  },
  {
    value: "script" as const,
    icon: FilePenLine,
    label: "剧本改编",
    desc: "分块提取角色并分集",
  },
] as const;

export function CreateProjectDialog() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("whole");
  const [sourceType, setSourceType] = useState<WholeDramaSource>("idea");
  const [title, setTitle] = useState("");
  const [outline, setOutline] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [visualStyle, setVisualStyle] = useState<string>(DEFAULT_VISUAL_STYLE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle("");
    setOutline("");
    setMode("whole");
    setSourceType("idea");
    setSourceFile(null);
    setLoading(false);
    setVisualStyle(DEFAULT_VISUAL_STYLE);
  }

  function selectSourceType(value: WholeDramaSource) {
    setSourceType(value);
    setSourceFile(null);
  }

  function handleSourceFile(file: File) {
    if (file.size > MAX_SOURCE_FILE_SIZE) {
      toast.error("文件不能超过 20MB");
      return;
    }
    setSourceFile(file);
  }

  async function handleCreate() {
    if (!title.trim()) return;
    if (mode === "whole" && !outline.trim() && !sourceFile) return;
    if (mode === "whole" && !sourceFile) {
      const lengthError = validateWholeDramaSourceLength(sourceType, outline);
      if (lengthError) {
        toast.error(lengthError);
        return;
      }
    }
    setLoading(true);

    try {
      let sourceText = outline;
      if (mode === "whole" && sourceFile) {
        const form = new FormData();
        form.append("file", sourceFile);
        const parseRes = await apiFetch("/api/projects/parse-source", {
          method: "POST",
          body: form,
        });
        const parsed = await parseRes.json().catch(() => null);
        if (!parseRes.ok || !parsed?.text) {
          throw new Error(parsed?.error || "文件解析失败");
        }
        const lengthError = validateWholeDramaSourceLength(sourceType, parsed.text);
        if (lengthError) throw new Error(lengthError);
        sourceText = parsed.text;
      }

      const body: {
        title: string;
        idea?: string;
        script?: string;
        wholeDramaSource?: WholeDramaSource;
        visualStyle?: string;
      } = { title };
      if (mode === "whole") {
        body.wholeDramaSource = sourceType;
        body.visualStyle = visualStyle;
        if (sourceType === "idea") body.idea = sourceText;
        else body.script = sourceText;
      }

      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "项目创建失败");
      }

      const project = await res.json();

      setOpen(false);
      reset();

      if (mode === "whole") {
        router.push(`/${locale}/project/${project.id}/auto-pipeline?source=${sourceType}&autoStart=1`);
      } else {
        router.push(`/${locale}/project/${project.id}/script`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "项目创建失败");
      setLoading(false);
    }
  }

  const canSubmit =
    !loading &&
    title.trim().length > 0 &&
    (mode === "blank" || outline.trim().length > 0 || sourceFile !== null);

  const sourceCopy = {
    idea: {
      label: "故事想法",
      hint: "描述世界观、主角、核心冲突即可",
      placeholder: "例如：少年剑客角色甲在末世大陆寻找失落的古剑，途中结识精灵弓手角色乙……",
      footer: "建议 100–500 字，最多 5,000 字；AI 将扩写为 8–24 集完整剧本",
    },
    novel: {
      label: "小说正文或梗概",
      hint: "粘贴需要改编的章节、正文或完整梗概",
      placeholder: "粘贴小说正文或剧情梗概。AI 会保留核心人物关系与主线冲突，将叙述转为可拍摄的多集漫剧剧本。",
      footer: "支持长文分段提炼，最多 120,000 字",
    },
    script: {
      label: "已有剧本",
      hint: "支持带“第 N 集”标题的结构化剧本",
      placeholder: "粘贴已有剧本。若包含“## 第 N 集”标题，系统会按标题直接分集；否则由 AI 自动拆分。",
      footer: "不限制字符数；上传文件最大 20MB，系统会分块分析角色与分集",
    },
  }[sourceType];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-3.5 w-3.5" />
        {t("dashboard.newProject")}
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[--primary]" />
            {t("dashboard.newProject")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Mode tabs */}
          <div className="flex rounded-xl border border-[--border-subtle] p-1 gap-1 bg-[--surface]">
            <button
              onClick={() => setMode("whole")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                mode === "whole"
                  ? "bg-white text-primary shadow-sm"
                  : "text-[--text-muted] hover:text-[--text-secondary]"
              }`}
            >
              <Wand2 className="h-3.5 w-3.5" />
              整剧模式
            </button>
            <button
              onClick={() => setMode("blank")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                mode === "blank"
                  ? "bg-white text-[--text-primary] shadow-sm"
                  : "text-[--text-muted] hover:text-[--text-secondary]"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              逐集模式
            </button>
          </div>

          {/* AI mode description */}
          {mode === "whole" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {WHOLE_DRAMA_SOURCES.map(({ value, icon: Icon, label, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => selectSourceType(value)}
                    className={`rounded-xl border px-2.5 py-3 text-left transition-all ${
                      sourceType === value
                        ? "border-primary/35 bg-primary/5 text-primary"
                        : "border-[--border-subtle] bg-white text-[--text-secondary] hover:border-primary/20"
                    }`}
                  >
                    <Icon className="mb-2 h-4 w-4" />
                    <div className="text-xs font-semibold">{label}</div>
                    <div className="mt-0.5 text-[10px] leading-tight text-[--text-muted]">{desc}</div>
                  </button>
                ))}
              </div>

              {/* Visual style — 整剧模式专属：创建后会自动触发角色提取，中间没有手动检查点，
                  必须在这里就把画风定下来，否则角色描述会被打上错误的风格锚定词。
                  逐集模式不需要：项目创建后不会自动生成任何内容，用户会先进到项目页
                  （顶部已有画风选择器），再手动去角色页点"提取角色"，中间有充分机会切换画风。 */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-visual-style" className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5 shrink-0 text-[--text-muted]" />
                  <span className="shrink-0">项目画风</span>
                </Label>
                <select
                  id="proj-visual-style"
                  value={visualStyle}
                  onChange={(e) => setVisualStyle(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[--border-subtle] bg-white px-3.5 text-sm text-[--text-primary] outline-none transition-all duration-200 hover:border-[--border-hover] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
                >
                  {Object.entries(VISUAL_STYLE_PRESETS).map(([value, preset]) => (
                    <option key={value} value={value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[--text-muted]">
                  角色提取与分镜生成将直接使用此画风，创建后仍可在项目页顶部切换
                </p>
              </div>

              <div className="rounded-xl bg-primary/5 border border-primary/15 px-3.5 py-3 text-xs text-primary leading-relaxed">
                <strong>整剧规划：</strong>
                一次完成剧本规划、角色提取、分集与项目入库，完成后可逐集解析分镜。
              </div>
            </div>
          )}

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="proj-title">{t("project.title")}</Label>
            <Input
              id="proj-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={mode === "whole" ? "例如：《大剑勇者》" : "My Epic Comic..."}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && mode === "blank") {
                  handleCreate();
                }
              }}
              autoFocus
            />
          </div>

          {/* Outline textarea (AI mode only) */}
          {mode === "whole" && (
            <div className="space-y-2">
              <Label htmlFor="proj-outline">
                {sourceCopy.label}
                <span className="ml-1 text-[10px] font-normal text-[--text-muted]">
                  （{sourceCopy.hint}）
                </span>
              </Label>
              <Textarea
                id="proj-outline"
                value={outline}
                disabled={Boolean(sourceFile)}
                onChange={(e) => {
                  setOutline(e.target.value);
                  if (e.target.value) setSourceFile(null);
                }}
                placeholder={sourceCopy.placeholder}
                className="min-h-[130px] resize-none text-sm leading-relaxed disabled:opacity-50"
              />
              <p className="text-[10px] text-[--text-muted]">
                {outline.length} 字 · {sourceCopy.footer}
              </p>
              {sourceType !== "idea" && (
                <div className="rounded-xl border border-dashed border-[--border-subtle] bg-[--surface]/60 p-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_SOURCE_FILES}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleSourceFile(file);
                      event.target.value = "";
                    }}
                  />
                  {sourceFile ? (
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[--text-primary]">{sourceFile.name}</p>
                        <p className="text-[10px] text-[--text-muted]">
                          {(sourceFile.size / 1024).toFixed(1)} KB · 创建后自动解析
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSourceFile(null)}
                        className="rounded-md p-1 text-[--text-muted] hover:bg-red-50 hover:text-red-500"
                        aria-label="移除文件"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full items-center justify-center gap-2 text-xs text-[--text-secondary] hover:text-primary"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      或上传 TXT、Markdown、DOCX、PDF（最大 20MB）
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <Button onClick={handleCreate} disabled={!canSubmit} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                创建中...
              </>
            ) : mode === "whole" ? (
              <>
                <Wand2 className="h-4 w-4" />
                创建并启动整剧规划
              </>
            ) : (
              t("common.create")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
