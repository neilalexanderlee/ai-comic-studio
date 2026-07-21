"use client";

import { useState, useEffect, useRef } from "react";
import { Download, Image as ImageIcon, Loader2, Sparkles, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";

/**
 * 将封面图缩放为平台要求格式：2:3 比例，高度 ≤2000px（最终 1334×2000），JPEG ≤2MB
 */
async function exportCoverForPlatform(imgSrc: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = imgSrc;
  });

  // 目标：2:3，高度恰好 2000px（平台上限），宽度 1334px
  const TARGET_W = 1334;
  const TARGET_H = 2000;

  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d")!;

  // 源图可能比例略偏，做等比缩放后居中裁剪到精确 2:3
  const targetRatio = TARGET_W / TARGET_H;
  const srcRatio = img.naturalWidth / img.naturalHeight;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (srcRatio > targetRatio) {
    sw = img.naturalHeight * targetRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / targetRatio;
    sy = 0; // 保留顶部
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);

  // 自动压缩 ≤2MB
  let quality = 0.92;
  let blob: Blob | null = null;
  while (quality >= 0.5) {
    blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob((b) => r(b), "image/jpeg", quality)
    );
    if (!blob || blob.size <= 2 * 1024 * 1024) break;
    quality -= 0.05;
  }
  if (!blob) { alert("导出失败，请重试"); return; }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cover_platform_1334x2000.jpg";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 项目主角名单为空时的占位符：仅作为默认封面文案的示例角色，不绑定具体项目剧情。
// 用户打开对话框后应根据实际角色名单编辑下方 DEFAULT_COVER_PROMPT 和参考图勾选。
const HERO_NAMES = ["角色甲", "角色乙", "角色丙", "角色丁", "角色戊", "角色己"];

const DEFAULT_COVER_PROMPT = `日本2D动漫风格，竖版史诗海报，电影级构图，极高画质。
多位主角并肩而立，构图居中人物最突出，两侧人物依次向外排开，服装/武器/发色各自区分角色身份。
背景：呼应剧情基调的环境元素与光影氛围，整体色调对比鲜明，人物被轮廓光勾勒，顶部留有标题区（暗色渐变压字区）。手绘质感线条，高细节，短剧海报封面风格。`;

interface CharacterAsset { id: string; imagePath: string; tag: string; isDefault: number; }
interface Character { id: string; name: string; visualHint: string | null; assets: CharacterAsset[]; }
interface RefOption { key: string; label: string; charName: string; tag: string; }

interface CoverImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function CoverImageDialog({ open, onOpenChange, projectId }: CoverImageDialogProps) {
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const providers = useModelStore((s) => s.providers);
  const defaultImageModel = useModelStore((s) => s.defaultImageModel);

  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(() => defaultImageModel);
  const [prompt, setPrompt] = useState(DEFAULT_COVER_PROMPT);
  const [generating, setGenerating] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);

  const [options, setOptions] = useState<RefOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingChars, setLoadingChars] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoadingChars(true);
    apiFetch(`/api/projects/${projectId}/characters`)
      .then((r) => r.json())
      .then((data: Character[]) => {
        const opts: RefOption[] = [];
        for (const char of data) {
          for (const asset of (char.assets ?? [])) {
            opts.push({ key: asset.imagePath, label: `${char.name} · ${asset.tag}`, charName: char.name, tag: asset.tag });
          }
        }
        setOptions(opts);
        const auto = new Set<string>();
        for (const hero of HERO_NAMES) {
          const charOpts = opts.filter((o) => o.charName === hero);
          const pick = charOpts.find((o) => o.tag === "武装") ?? charOpts.find((o) => o.tag === "日常") ?? charOpts[0];
          if (pick) auto.add(pick.key);
        }
        setSelected(auto);
      })
      .catch(console.error)
      .finally(() => setLoadingChars(false));
  }, [open, projectId]);

  function resolveImageRef(ref: ModelRef | null) {
    if (!ref) return null;
    const p = providers.find((p) => p.id === ref.providerId);
    if (!p) return null;
    return { providerId: p.id, protocol: p.protocol, baseUrl: p.baseUrl, apiKey: p.apiKey || "", secretKey: p.secretKey, modelId: ref.modelId };
  }

  function toggleOption(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); return next; }
      if (next.size >= 14) { toast.error("最多选 14 张参考图"); return prev; }
      next.add(key);
      return next;
    });
  }

  async function handleGenerate() {
    if (!prompt.trim()) { toast.error("请输入封面图描述"); return; }
    const imageConf = resolveImageRef(imageModelRef);
    if (!imageConf) { toast.error("请先配置图片模型"); return; }
    setGenerating(true);
    setResultPath(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cover_image_generate",
          payload: {
            prompt: prompt.trim(),
            referenceImagePaths: Array.from(selected),
            referenceLabels: Array.from(selected).map(
              (k) => options.find((o) => o.key === k)?.charName ?? ""
            ),
          },
          modelConfig: { ...getModelConfig(), image: imageConf },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "生成失败");
      setResultPath(data.imagePath);
      toast.success("封面图生成成功");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  }

  const summaryText = selected.size === 0
    ? "不使用参考图"
    : Array.from(selected).map((k) => options.find((o) => o.key === k)?.label ?? "").filter(Boolean).join("、");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <ImageIcon className="h-4 w-4 text-primary" />
            生成封面图
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">

          {/* 参考图多选下拉 */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[--text-secondary]">
              角色定妆图参考（已选 {selected.size} / 14）
            </label>
            <div className="relative" ref={dropRef}>
              <button
                type="button"
                onClick={() => setDropOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-[--border-subtle] bg-white px-3 py-2 text-left text-xs shadow-sm transition hover:border-primary/30"
              >
                <span className="truncate text-[--text-secondary]">
                  {loadingChars ? "加载中..." : summaryText}
                </span>
                <ChevronDown className={`ml-2 h-3.5 w-3.5 flex-shrink-0 text-[--text-muted] transition-transform ${dropOpen ? "rotate-180" : ""}`} />
              </button>
              {dropOpen && !loadingChars && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[--border-subtle] bg-white shadow-lg">
                  {options.length === 0 ? (
                    <p className="px-3 py-3 text-center text-xs text-[--text-muted]">暂无定妆图</p>
                  ) : options.map((opt) => {
                    const checked = selected.has(opt.key);
                    return (
                      <button key={opt.key} type="button" onClick={() => toggleOption(opt.key)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-[--surface]">
                        <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-white" : "border-[--border-subtle]"}`}>
                          {checked && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span className={checked ? "text-[--text-primary]" : "text-[--text-secondary]"}>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 提示词 */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[--text-secondary]">封面描述（可编辑）</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-[--border-subtle] bg-[--surface] px-3 py-2 text-xs text-[--text-primary] focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 resize-y"
            />
          </div>

          {/* 模型 */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[--text-secondary]">图片模型</label>
            <InlineModelPicker capability="image" value={imageModelRef} onChange={setImageModelRef} />
          </div>

          <p className="text-[11px] text-[--text-muted]">
            比例：2:3 竖版（1664×2496px 2K，符合红果封面 ≥350×500px 要求）
          </p>

          <Button onClick={handleGenerate} disabled={generating} className="w-full rounded-[10px]">
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generating ? "生成中..." : `生成封面图${selected.size > 0 ? `（含 ${selected.size} 张定妆参考）` : ""}`}
          </Button>

          {/* 生成结果预览 */}
          {(generating || resultPath) && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <div className="relative mx-auto overflow-hidden rounded-xl border border-[--border-subtle] bg-[--surface]" style={{ width: 140, height: 210 }}>
                {resultPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={uploadUrl(resultPath)} alt="封面预览" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-[--text-muted]" />
                  </div>
                )}
              </div>
              {resultPath && (
                <div className="flex flex-col gap-1.5 w-full">
                  <Button variant="outline" size="sm" className="w-full rounded-[10px] text-xs"
                    onClick={() => { const a = document.createElement("a"); a.href = uploadUrl(resultPath!); a.download = "cover.png"; a.click(); }}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    下载原图（1664×2496）
                  </Button>
                  <Button size="sm" className="w-full rounded-[10px] text-xs"
                    onClick={() => exportCoverForPlatform(uploadUrl(resultPath!))}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    导出平台格式（1334×2000 ≤2MB）
                  </Button>
                  <p className="text-center text-[10px] text-[--text-muted]">平台要求高度 ≤2000px，比例 2:3</p>
                </div>
              )}
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}
