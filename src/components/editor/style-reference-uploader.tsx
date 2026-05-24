"use client";

import { useRef, useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { ImagePlus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";

/**
 * 画风参考图上传器（顶栏按钮）
 *
 * 当生成首帧且该镜头没有命名角色时（charRefs=0，群演/空镜），
 * 此图会作为视觉画风锚点注入到图片生成的 referenceImages 中，
 * 防止模型在无定妆图镜头上发生风格漂移。
 */
export function StyleReferenceUploader() {
  const { project, updateStyleReferenceImage } = useProjectStore();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!project) return null;

  const current = project.styleReferenceImage;

  // Convert server file path to a displayable URL via the static file API
  const previewUrl = current ? uploadUrl(current) : null;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`/api/projects/${project.id}/upload-style-ref`, {
        method: "POST",
        body: form,
      });
      const data = await res.json() as { styleReferenceImage: string };
      updateStyleReferenceImage(data.styleReferenceImage);
      toast.success("画风参考图已上传");
    } catch {
      toast.error("上传失败");
    }
    setUploading(false);
    // Reset input so re-uploading same file triggers onChange
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDelete() {
    if (!project) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/projects/${project.id}/upload-style-ref`, { method: "DELETE" });
      updateStyleReferenceImage(null);
      toast.success("已删除画风参考图");
    } catch {
      toast.error("删除失败");
    }
    setDeleting(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="画风参考图（用于空镜/群演风格锚定）"
        className={[
          "flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-xs font-medium border transition-colors",
          current
            ? "border-[--primary]/40 bg-[--primary]/5 text-[--primary] hover:bg-[--primary]/10"
            : "border-[--border-subtle] bg-white text-[--text-muted] hover:bg-[--surface] hover:text-[--text-primary]",
        ].join(" ")}
      >
        <ImagePlus className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">{current ? "画风参考" : "画风参考图"}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-[--border-subtle] bg-white shadow-lg p-3 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[--text-muted]">
              画风参考图
            </div>
            <p className="text-xs text-[--text-muted] leading-relaxed">
              上传一张与定妆图同画风的风景/场景图。无命名角色的镜头（群演、空镜）生成首帧时会自动引用此图作为画风锚点。
            </p>

            {previewUrl && (
              <div className="relative rounded-lg overflow-hidden aspect-video bg-[--surface]">
                <Image
                  src={previewUrl}
                  alt="画风参考图"
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg h-9 text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {uploading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span>上传中…</span></>
                  : <><ImagePlus className="h-3.5 w-3.5" /><span>{current ? "替换图片" : "上传图片"}</span></>
                }
              </button>
              {current && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  title="删除参考图"
                  className="flex items-center justify-center w-9 h-9 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {deleting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />
                  }
                </button>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </>
      )}
    </div>
  );
}
