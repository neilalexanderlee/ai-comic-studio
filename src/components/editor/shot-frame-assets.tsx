"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageIcon, Loader2, RefreshCw, Trash2, Upload, XCircle } from "lucide-react";
import { uploadUrl } from "@/lib/utils/upload-url";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { useFrameImageMissing } from "@/hooks/use-frame-image-missing";

type EditableField = "anchorFirst" | "anchorLastAi";

type ShotFrameAssetsProps = {
  projectId: string;
  shotId: string;
  anchorFirst: string | null;
  anchorLastAi: string | null;
  cutPoint?: string | null;
  onPreview: (src: string) => void;
  onUpdate: () => void;
  generatingFrames: boolean;
  generatingFrameTarget: "first" | "last" | null;
  onGenerateOneFrame: (target: "first" | "last") => void;
  disabled?: boolean;
};

function FrameCell({
  src,
  label,
  readOnly,
  pathMissing,
  isUploading,
  canRegen,
  regenSpinning,
  onPreview,
  onUpload,
  onClear,
  onRegen,
  disabled,
}: {
  src: string | null | undefined;
  label: string;
  readOnly?: boolean;
  pathMissing: boolean;
  isUploading: boolean;
  canRegen: boolean;
  regenSpinning: boolean;
  onPreview: () => void;
  onUpload?: () => void;
  onClear?: () => void;
  onRegen?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-1 min-w-0 flex-col gap-1">
      <div
        className={`overflow-hidden rounded-lg border bg-[--surface] ${
          pathMissing ? "border-red-500 ring-1 ring-red-500/40" : "border-[--border-subtle]"
        } ${src && !pathMissing && !isUploading ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
        onClick={() => src && !pathMissing && !isUploading && onPreview()}
      >
        {isUploading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : src && !pathMissing ? (
          <img src={uploadUrl(src)} className="w-full object-contain" alt={label} />
        ) : pathMissing ? (
          <div className="flex h-16 flex-col items-center justify-center gap-0.5 px-1">
            <XCircle className="h-4 w-4 text-red-500" />
            <span className="text-[9px] text-red-600 text-center">文件缺失</span>
          </div>
        ) : (
          <div className="flex h-16 items-center justify-center">
            <ImageIcon className="h-4 w-4 text-[--text-muted]" />
          </div>
        )}
      </div>
      <p
        className={`text-[10px] text-center truncate ${
          pathMissing ? "text-red-600 font-medium" : "text-[--text-muted]"
        }`}
      >
        {label}
        {pathMissing ? " · 缺失" : ""}
      </p>
      {!readOnly && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onUpload}
            disabled={isUploading || disabled}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[--border-subtle] bg-white py-0.5 text-[10px] text-[--text-muted] hover:border-primary/40 hover:text-primary disabled:opacity-40"
          >
            <Upload className="h-2.5 w-2.5" />
            上传
          </button>
          {src && (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              className="flex items-center justify-center rounded-md border border-[--border-subtle] bg-white px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:border-red-300 hover:text-red-500 disabled:opacity-40"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          )}
          {canRegen && (
            <button
              type="button"
              onClick={onRegen}
              disabled={disabled || isUploading}
              title="单独重新生成"
              className="flex items-center justify-center rounded-md border border-[--border-subtle] bg-white px-1.5 py-0.5 text-[--text-muted] hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              {regenSpinning ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <RefreshCw className="h-2.5 w-2.5" />
              )}
            </button>
          )}
        </div>
      )}
      {readOnly && !src && (
        <p className="text-[9px] text-center text-[--text-muted]">生成视频后出现</p>
      )}
    </div>
  );
}

function FrameCellWithMissing(props: Omit<Parameters<typeof FrameCell>[0], "pathMissing"> & { src: string | null | undefined }) {
  const pathMissing = useFrameImageMissing(props.src);
  return <FrameCell {...props} pathMissing={pathMissing} />;
}

/** 三格帧预览 + 上传/清除/单帧重生（抽屉与后续列表精简共用） */
export function ShotFrameAssets({
  projectId,
  shotId,
  anchorFirst,
  anchorLastAi,
  cutPoint,
  onPreview,
  onUpdate,
  generatingFrames,
  generatingFrameTarget,
  onGenerateOneFrame,
  disabled = false,
}: ShotFrameAssetsProps) {
  const t = useTranslations();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadFieldRef = useRef<EditableField | null>(null);
  const [uploadingField, setUploadingField] = useState<EditableField | null>(null);

  async function patchShot(fields: Record<string, unknown>) {
    await apiFetch(`/api/projects/${projectId}/shots/${shotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function handleClearFrame(field: EditableField) {
    try {
      await patchShot({ [field]: null });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清除失败");
    }
  }

  function handleUploadFrame(field: EditableField) {
    uploadFieldRef.current = field;
    uploadInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const field = uploadFieldRef.current;
    if (!file || !field) return;
    e.target.value = "";
    setUploadingField(field);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("field", field);
      const res = await apiFetch(`/api/projects/${projectId}/shots/${shotId}/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    } finally {
      setUploadingField(null);
    }
  }

  const blocked = disabled || generatingFrames;

  return (
    <>
      <div className="mb-2 flex gap-2">
        <FrameCellWithMissing
          src={anchorFirst}
          label={t("shot.anchorFirst")}
          isUploading={uploadingField === "anchorFirst"}
          canRegen
          regenSpinning={generatingFrames && generatingFrameTarget === "first"}
          onPreview={() => anchorFirst && onPreview(uploadUrl(anchorFirst))}
          onUpload={() => handleUploadFrame("anchorFirst")}
          onClear={() => handleClearFrame("anchorFirst")}
          onRegen={() => onGenerateOneFrame("first")}
          disabled={blocked}
        />
        <FrameCellWithMissing
          src={anchorLastAi}
          label={t("shot.anchorLastAi")}
          isUploading={uploadingField === "anchorLastAi"}
          canRegen
          regenSpinning={generatingFrames && generatingFrameTarget === "last"}
          onPreview={() => anchorLastAi && onPreview(uploadUrl(anchorLastAi))}
          onUpload={() => handleUploadFrame("anchorLastAi")}
          onClear={() => handleClearFrame("anchorLastAi")}
          onRegen={() => onGenerateOneFrame("last")}
          disabled={blocked}
        />
        <FrameCellWithMissing
          src={cutPoint}
          label={t("shot.cutPoint")}
          readOnly
          isUploading={false}
          canRegen={false}
          regenSpinning={false}
          onPreview={() => cutPoint && onPreview(uploadUrl(cutPoint))}
          disabled={blocked}
        />
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </>
  );
}
