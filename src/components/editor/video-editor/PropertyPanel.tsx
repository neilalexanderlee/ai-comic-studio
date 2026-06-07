"use client";

import { useEditorStore } from "./hooks/useEditorStore";
import { formatTime } from "./utils/clipMeta";
import type { SubtitleStyle } from "./utils/clipMeta";
import { Trash2 } from "lucide-react";

export function PropertyPanel() {
  const selectedClip = useEditorStore((s) => s.getSelectedClip());
  const updateClip = useEditorStore((s) => s.updateClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const selectClip = useEditorStore((s) => s.selectClip);

  if (!selectedClip) {
    return (
      <div className="flex h-full items-center justify-center border-l border-[--border-subtle] bg-white">
        <p className="text-[12px] text-[--text-muted]">点击时间线上的片段查看属性</p>
      </div>
    );
  }

  function updateStyle(key: keyof SubtitleStyle, value: unknown) {
    updateClip(selectedClip!.id, {
      subtitleStyle: { ...(selectedClip!.subtitleStyle ?? {}), [key]: value },
    });
  }

  return (
    <div className="flex h-full flex-col border-l border-[--border-subtle] bg-white overflow-y-auto">
      {/* 标题 */}
      <div className="flex items-center justify-between border-b border-[--border-subtle] px-3 py-2.5">
        <div>
          <p className="text-[12px] font-semibold text-[--text-primary]">{selectedClip.name}</p>
          <p className="text-[10px] text-[--text-muted]">{selectedClip.type}</p>
        </div>
        <button
          onClick={() => { removeClip(selectedClip.id); selectClip(null); }}
          className="flex h-6 w-6 items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-4 p-3">
        {/* 基础：时间 */}
        <section>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">时间</p>
          <div className="space-y-1.5">
            <Row label="开始">
              <input
                type="number"
                step={0.1}
                min={0}
                value={selectedClip.startTime.toFixed(1)}
                onChange={(e) => {
                  const start = parseFloat(e.target.value);
                  updateClip(selectedClip.id, { startTime: start, endTime: start + selectedClip.duration });
                }}
                className="w-full rounded border border-[--border-subtle] px-2 py-1 text-[11px] outline-none focus:border-primary/50"
              />
            </Row>
            <Row label="时长">
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={selectedClip.duration.toFixed(1)}
                onChange={(e) => {
                  const dur = parseFloat(e.target.value);
                  updateClip(selectedClip.id, { duration: dur, endTime: selectedClip.startTime + dur });
                }}
                className="w-full rounded border border-[--border-subtle] px-2 py-1 text-[11px] outline-none focus:border-primary/50"
              />
            </Row>
          </div>
        </section>

        {/* 视频属性 */}
        {selectedClip.type === "video" && (
          <section>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[--text-muted]">视频</p>
            <p className="text-[10px] text-[--text-muted] truncate">{selectedClip.url?.split("/").pop()}</p>
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
            <Row label="淡入">
              <input
                type="number" step={0.1} min={0} max={5}
                value={selectedClip.fadeIn ?? 0}
                onChange={(e) => updateClip(selectedClip.id, { fadeIn: parseFloat(e.target.value) })}
                className="w-full rounded border border-[--border-subtle] px-2 py-1 text-[11px] outline-none focus:border-primary/50"
              />
            </Row>
            <Row label="淡出">
              <input
                type="number" step={0.1} min={0} max={5}
                value={selectedClip.fadeOut ?? 0}
                onChange={(e) => updateClip(selectedClip.id, { fadeOut: parseFloat(e.target.value) })}
                className="w-full rounded border border-[--border-subtle] px-2 py-1 text-[11px] outline-none focus:border-primary/50"
              />
            </Row>
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
