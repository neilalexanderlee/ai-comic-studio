"use client";

import { useEditorStore } from "./hooks/useEditorStore";
import { formatTime } from "./utils/clipMeta";
import type { SubtitleStyle } from "./utils/clipMeta";
import { Trash2, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { uploadUrl } from "@/lib/utils/upload-url";

/** 数字输入框：本地维护字符串状态，blur/Enter 时才提交，避免受控输入打字困难 */
function NumInput({
  value,
  min = 0,
  step = 0.1,
  onChange,
}: {
  value: number;
  min?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));

  // 外部 value 变化时（如拖拽 clip）同步进来
  useEffect(() => {
    setLocal(String(parseFloat(value.toFixed(1))));
  }, [value]);

  function commit(raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= min) onChange(n);
    else setLocal(String(parseFloat(value.toFixed(1)))); // 恢复原值
  }

  return (
    <input
      type="number"
      step={step}
      min={min}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      className="w-full rounded border border-[--border-subtle] px-2 py-1 text-[11px] outline-none focus:border-primary/50"
    />
  );
}

export function PropertyPanel() {
  const selectedClip = useEditorStore((s) => s.getSelectedClip());
  const updateClip = useEditorStore((s) => s.updateClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const selectClip = useEditorStore((s) => s.selectClip);
  const globalSubtitleStyle = useEditorStore((s) => s.globalSubtitleStyle);
  const setGlobalSubtitleStyle = useEditorStore((s) => s.setGlobalSubtitleStyle);

  /**
   * 重置当前视频 clip 的时长并做 ripple 更新：
   * 后续同视频轨的视频 clip、以及所有非视频 clip（BGM/字幕）按 delta 向后平移。
   */
  function resetDurationWithRipple(clipId: string, newDuration: number) {
    const tracks = useEditorStore.getState().tracks;
    const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!clip) return;

    const oldEndTime = clip.endTime;
    const newEndTime = clip.startTime + newDuration;
    const delta = newEndTime - oldEndTime;
    if (Math.abs(delta) < 0.001) return; // 无变化

    // 更新当前 clip
    updateClip(clipId, { duration: newDuration, endTime: newEndTime });

    if (Math.abs(delta) < 0.001) return;

    // ripple：所有 startTime >= oldEndTime 的 clip 向后平移 delta
    for (const track of tracks) {
      for (const c of track.clips) {
        if (c.id === clipId) continue;
        if (c.startTime >= oldEndTime - 0.001) {
          updateClip(c.id, {
            startTime: c.startTime + delta,
            endTime: c.endTime + delta,
          });
        }
      }
    }
  }

  // tab: "clip" | "subtitle"
  const [tab, setTab] = useState<"clip" | "subtitle">("clip");

  function updateStyle(key: keyof SubtitleStyle, value: unknown) {
    updateClip(selectedClip!.id, {
      subtitleStyle: { ...(selectedClip!.subtitleStyle ?? {}), [key]: value },
    });
  }

  return (
    <div className="flex h-full flex-col border-l border-[--border-subtle] bg-white overflow-hidden">
      {/* Tab 切换 */}
      <div className="flex shrink-0 border-b border-[--border-subtle]">
        <button
          onClick={() => setTab("clip")}
          className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
            tab === "clip"
              ? "border-b-2 border-primary text-primary"
              : "text-[--text-muted] hover:text-[--text-primary]"
          }`}
        >
          片段属性
        </button>
        <button
          onClick={() => setTab("subtitle")}
          className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
            tab === "subtitle"
              ? "border-b-2 border-primary text-primary"
              : "text-[--text-muted] hover:text-[--text-primary]"
          }`}
        >
          全局字幕
        </button>
      </div>

      {/* 全局字幕 tab */}
      {tab === "subtitle" && (
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-3 p-3">
            <p className="text-[10px] text-[--text-muted] leading-relaxed">
              设置导出时所有字幕的默认样式。点击「应用到全部」批量更新时间线上的字幕片段。
            </p>
            <div className="space-y-2">
              <Row label="字号">
                <NumInput
                  value={globalSubtitleStyle.fontSize ?? 32}
                  min={12}
                  step={2}
                  onChange={(v) => setGlobalSubtitleStyle({ fontSize: v })}
                />
              </Row>
              <Row label="颜色">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={globalSubtitleStyle.color ?? "#ffffff"}
                    onChange={(e) => setGlobalSubtitleStyle({ color: e.target.value })}
                    className="h-7 w-10 rounded border border-[--border-subtle] cursor-pointer"
                  />
                  <span className="text-[10px] text-[--text-muted]">{globalSubtitleStyle.color ?? "#ffffff"}</span>
                </div>
              </Row>
              <Row label="对齐">
                <select
                  value={globalSubtitleStyle.textAlign ?? "center"}
                  onChange={(e) => setGlobalSubtitleStyle({ textAlign: e.target.value as "left" | "center" | "right" })}
                  className="w-full rounded border border-[--border-subtle] px-2 py-1 text-[11px] outline-none focus:border-primary/50"
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </Row>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[--text-muted]">垂直位置</span>
                  <span className="text-[10px] text-[--text-muted]">{Math.round((globalSubtitleStyle.y ?? 0.82) * 100)}%</span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={globalSubtitleStyle.y ?? 0.82}
                  onChange={(e) => setGlobalSubtitleStyle({ y: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
            <button
              onClick={() => setGlobalSubtitleStyle(globalSubtitleStyle, true)}
              className="w-full rounded bg-primary py-1.5 text-[11px] font-medium text-white hover:bg-primary/90 transition-colors"
            >
              应用到全部字幕
            </button>
          </div>
        </div>
      )}

      {/* 片段属性 tab */}
      {tab === "clip" && !selectedClip && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[11px] text-[--text-muted]">点击时间线上的片段</p>
        </div>
      )}

      {tab === "clip" && selectedClip && (
      <>
      {/* 标题 */}
      <div className="flex shrink-0 items-center justify-between border-b border-[--border-subtle] px-3 py-2">
        <div>
          <p className="text-[12px] font-semibold text-[--text-primary] truncate max-w-[90px]">{selectedClip.name}</p>
          <p className="text-[10px] text-[--text-muted]">{selectedClip.type}</p>
        </div>
        <button
          onClick={() => { removeClip(selectedClip.id); selectClip(null); }}
          className="flex h-6 w-6 items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
      <div className="space-y-4 p-3">
        {/* 基础：时间 */}
        <section>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">时间</p>
          <div className="space-y-1.5">
            <Row label="开始">
              <NumInput
                value={selectedClip.startTime}
                min={0}
                onChange={(start) => updateClip(selectedClip.id, { startTime: start, endTime: start + selectedClip.duration })}
              />
            </Row>
            <Row label="时长">
              <NumInput
                value={selectedClip.duration}
                min={0.1}
                onChange={(dur) => updateClip(selectedClip.id, { duration: dur, endTime: selectedClip.startTime + dur })}
              />
            </Row>
          </div>
        </section>

        {/* 视频属性 */}
        {selectedClip.type === "video" && (
          <section>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">视频</p>
            <p className="text-[10px] text-[--text-muted] truncate mb-2">{selectedClip.url?.split("/").pop()}</p>
            <ProbeButton
              url={selectedClip.url}
              onProbed={(actual) => resetDurationWithRipple(selectedClip.id, actual)}
            />
          </section>
        )}

        {/* 视频裁剪 */}
        {selectedClip.type === "video" && (
          <section>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">裁剪</p>
            <div className="space-y-1.5">
              <Row label="起点">
                <NumInput
                  value={selectedClip.trimStart ?? 0}
                  min={0}
                  step={0.1}
                  onChange={(v) => updateClip(selectedClip.id, { trimStart: v })}
                />
              </Row>
              <Row label="终点">
                <NumInput
                  value={selectedClip.trimEnd ?? selectedClip.duration}
                  min={0.1}
                  step={0.1}
                  onChange={(v) => updateClip(selectedClip.id, { trimEnd: v })}
                />
              </Row>
              <p className="text-[9px] text-[--text-muted]">
                起点/终点为素材内偏移秒数，留空 = 使用全段
              </p>
            </div>
          </section>
        )}

        {/* 当前特效 */}
        {selectedClip.type === "video" && selectedClip.effectType && (
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">特效</p>
              <button
                onClick={() => updateClip(selectedClip.id, { effectType: undefined })}
                className="text-[9px] text-red-400 hover:text-red-600 transition-colors"
              >
                移除
              </button>
            </div>
            <p className="text-[11px] font-medium text-primary px-2 py-1 rounded bg-primary/8 border border-primary/20">
              {selectedClip.effectType}
            </p>
          </section>
        )}

        {/* 音频属性 */}
        {(selectedClip.type === "audio" || selectedClip.type === "bgm") && (
          <section>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">音频</p>
            <Row label="音量">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0} max={2} step={0.05}
                  value={selectedClip.volume ?? 1}
                  onChange={(e) => updateClip(selectedClip.id, { volume: parseFloat(e.target.value) })}
                  className="flex-1"
                />
                <span className="w-8 text-right text-[10px] text-[--text-muted]">
                  {Math.round((selectedClip.volume ?? 1) * 100)}%
                </span>
              </div>
            </Row>
            <FadeRow
              label="淡入"
              value={selectedClip.fadeIn ?? 0}
              onChange={(v) => updateClip(selectedClip.id, { fadeIn: v })}
            />
            <FadeRow
              label="淡出"
              value={selectedClip.fadeOut ?? 0}
              onChange={(v) => updateClip(selectedClip.id, { fadeOut: v })}
            />
          </section>
        )}

        {/* 字幕属性 */}
        {selectedClip.type === "subtitle" && (
          <section>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">字幕</p>
            <div className="space-y-2">
              <textarea
                value={selectedClip.text ?? ""}
                onChange={(e) => updateClip(selectedClip.id, { name: e.target.value.slice(0, 20), text: e.target.value })}
                rows={3}
                className="w-full rounded border border-[--border-subtle] px-2 py-1.5 text-[11px] outline-none focus:border-primary/50 resize-none"
                placeholder="字幕内容"
              />
              <Row label="字号">
                <input
                  type="number" min={12} max={96} step={2}
                  value={selectedClip.subtitleStyle?.fontSize ?? 32}
                  onChange={(e) => updateStyle("fontSize", parseInt(e.target.value))}
                  className="w-full rounded border border-[--border-subtle] px-2 py-1 text-[11px] outline-none focus:border-primary/50"
                />
              </Row>
              <Row label="颜色">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selectedClip.subtitleStyle?.color ?? "#ffffff"}
                    onChange={(e) => updateStyle("color", e.target.value)}
                    className="h-7 w-10 rounded border border-[--border-subtle] cursor-pointer"
                  />
                  <span className="text-[10px] text-[--text-muted]">{selectedClip.subtitleStyle?.color ?? "#ffffff"}</span>
                </div>
              </Row>
              <Row label="对齐">
                <select
                  value={selectedClip.subtitleStyle?.textAlign ?? "center"}
                  onChange={(e) => updateStyle("textAlign", e.target.value)}
                  className="w-full rounded border border-[--border-subtle] px-2 py-1 text-[11px] outline-none focus:border-primary/50"
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </Row>
              <Row label="垂直位置">
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={selectedClip.subtitleStyle?.y ?? 0.82}
                  onChange={(e) => updateStyle("y", parseFloat(e.target.value))}
                  className="w-full"
                />
              </Row>
            </div>
          </section>
        )}

        {/* 转场属性 */}
        {selectedClip.type === "transition" && (
          <section>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">转场</p>
            <p className="text-[12px] text-[--text-primary]">{selectedClip.transitionType}</p>
          </section>
        )}
      </div>
      </div>
      </>
      )}
    </div>
  );
}

/** 从视频文件探测真实时长，用于修正误改的时长值 */
function ProbeButton({ url, onProbed }: { url?: string | null; onProbed: (duration: number) => void }) {
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function probe() {
    if (!url) return;
    setProbing(true);
    setResult(null);
    try {
      const actual = await new Promise<number>((resolve) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => { resolve(v.duration); v.src = ""; };
        v.onerror = () => resolve(0);
        v.src = uploadUrl(url);
      });
      if (actual > 0) {
        onProbed(actual);
        setResult(`已重置为 ${actual.toFixed(1)}s`);
      } else {
        setResult("探测失败");
      }
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={probe}
        disabled={probing || !url}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-[--border-subtle] bg-[--surface] py-1 text-[10px] text-[--text-muted] hover:border-primary/40 hover:text-primary disabled:opacity-50 transition-colors"
      >
        <RefreshCw className={`h-2.5 w-2.5 ${probing ? "animate-spin" : ""}`} />
        从文件重置时长
      </button>
      {result && <p className="text-center text-[9px] text-emerald-600">{result}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[10px] text-[--text-muted]">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const FADE_PRESETS = [0, 0.5, 1, 2];

function FadeRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1 mt-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[--text-muted]">{label}</span>
        <span className="text-[10px] font-medium text-[--text-primary]">
          {value === 0 ? "无" : `${value}s`}
        </span>
      </div>
      {/* 预设按钮 */}
      <div className="flex gap-1">
        {FADE_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`flex-1 rounded py-0.5 text-[10px] transition-colors border ${
              value === p
                ? "bg-primary text-white border-primary"
                : "bg-[--surface] text-[--text-muted] border-[--border-subtle] hover:border-primary/40 hover:text-primary"
            }`}
          >
            {p === 0 ? "无" : `${p}s`}
          </button>
        ))}
      </div>
      {/* 滑块（精细调节） */}
      <input
        type="range" min={0} max={3} step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 accent-primary"
      />
    </div>
  );
}
