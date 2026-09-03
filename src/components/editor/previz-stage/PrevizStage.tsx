"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { X, Loader2, Camera, Plus, Trash2, RotateCw } from "lucide-react";
import { useStageRenderer } from "./use-stage-renderer";
import {
  DEFAULT_FIGURE_HEIGHT,
  SHOT_SIZE_LABEL,
  distanceForShotSize,
  fovToFocal,
  focalToFov,
  parseBlocking,
  parseScene,
  shotSizeForDistance,
  type FigurePose,
  type PrevizBlocking,
  type PrevizScene,
  type ShotSize,
  type StageFigure,
} from "@/lib/previz/stage-types";

const POSE_LABEL: Record<FigurePose, string> = {
  stand: "站",
  sit: "坐",
  crouch: "蹲",
  lie: "倒",
  run: "跑",
};

// 浅灰背景上要压深一档才有对比；彼此之间留出可分辨的色相差，方便在画面里认人
const FIGURE_COLORS = ["#7d8290", "#6f7f92", "#907f6f", "#74886f", "#8a6f85", "#6f8590"];

interface PrevizStageProps {
  projectId: string;
  episodeId: string;
  shotId: string;
  /** 本镜出场的具名角色，用于首次打开时自动建演员 */
  shotCharacters: { id: string; name: string }[];
  videoRatio: string;
  onClose: () => void;
  onUpdate: () => void;
}

function ratioToAspect(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w && h ? w / h : 16 / 9;
}

export function PrevizStage({
  projectId,
  episodeId,
  shotId,
  shotCharacters,
  videoRatio,
  onClose,
  onUpdate,
}: PrevizStageProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);

  const [scene, setScene] = useState<PrevizScene | null>(null);
  const [blocking, setBlocking] = useState<PrevizBlocking | null>(null);
  const [selectedFigureId, setSelectedFigureId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const aspect = ratioToAspect(videoRatio);

  // ── 载入 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/previz-stage?shotId=${shotId}`
      );
      if (!res.ok) { toast.error("导演台载入失败"); onClose(); return; }
      const data = (await res.json()) as { scene: string | null; blocking: string | null };
      if (cancelled) return;

      let s = parseScene(data.scene);
      // 首次打开：把本镜的具名角色自动建成演员，省掉手工添加
      if (s.figures.length === 0 && shotCharacters.length > 0) {
        s = {
          ...s,
          figures: shotCharacters.map((c, i) => ({
            id: c.id,
            characterId: c.id,
            name: c.name,
            height: DEFAULT_FIGURE_HEIGHT,
            color: FIGURE_COLORS[i % FIGURE_COLORS.length],
          })),
        };
      }
      setScene(s);
      setBlocking(parseBlocking(data.blocking, s.figures));
      setSelectedFigureId(s.figures[0]?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [projectId, episodeId, shotId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rendererParams = useMemo(
    () => ({
      scene: scene ?? { version: 1 as const, blocks: [], figures: [] },
      blocking: blocking ?? parseBlocking(null, []),
      aspect,
      selectedFigureId,
    }),
    [scene, blocking, aspect, selectedFigureId]
  );
  const { handle, orbit } = useStageRenderer(editorRef, cameraRef, rendererParams);

  // ── 编辑视口交互：拖人物 / 环绕 / 缩放 ──────────────────────────────────
  const dragRef = useRef<{ mode: "orbit" | "figure"; figureId?: string; lastX: number; lastY: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const hitId = handle.current?.pickFigure(e.clientX, e.clientY) ?? null;
    if (hitId) {
      setSelectedFigureId(hitId);
      dragRef.current = { mode: "figure", figureId: hitId, lastX: e.clientX, lastY: e.clientY };
    } else {
      dragRef.current = { mode: "orbit", lastX: e.clientX, lastY: e.clientY };
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [handle]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === "orbit") {
      orbit.theta -= (e.clientX - d.lastX) * 0.008;
      orbit.phi = Math.min(Math.PI * 0.49, Math.max(0.08, orbit.phi - (e.clientY - d.lastY) * 0.006));
      d.lastX = e.clientX; d.lastY = e.clientY;
      return;
    }
    const ground = handle.current?.projectToGround(e.clientX, e.clientY);
    if (!ground || !d.figureId) return;
    setBlocking((prev) =>
      prev ? {
        ...prev,
        placements: prev.placements.map((p) =>
          p.figureId === d.figureId ? { ...p, x: ground.x, z: ground.z } : p
        ),
      } : prev
    );
  }, [handle, orbit]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);
  const onWheel = useCallback((e: React.WheelEvent) => {
    orbit.radius = Math.min(40, Math.max(1.5, orbit.radius * (1 + Math.sign(e.deltaY) * 0.12)));
  }, [orbit]);

  // ── 编辑操作 ────────────────────────────────────────────────────────────
  function patchBlocking(fn: (b: PrevizBlocking) => PrevizBlocking) {
    setBlocking((prev) => (prev ? fn(prev) : prev));
  }
  function patchPlacement(figureId: string, patch: Partial<{ rotY: number; pose: FigurePose }>) {
    patchBlocking((b) => ({
      ...b,
      placements: b.placements.map((p) => (p.figureId === figureId ? { ...p, ...patch } : p)),
    }));
  }

  const subject = scene?.figures.find((f) => f.id === blocking?.camera.subjectFigureId);
  const subjectHeight = subject?.height ?? DEFAULT_FIGURE_HEIGHT;
  const currentShotSize = blocking
    ? shotSizeForDistance(blocking.camera.distance, subjectHeight, blocking.camera.fov)
    : "medium";

  function applyShotSize(size: ShotSize) {
    patchBlocking((b) => ({
      ...b,
      camera: { ...b.camera, distance: distanceForShotSize(size, subjectHeight, b.camera.fov) },
    }));
  }

  function addFigure() {
    setScene((prev) => {
      if (!prev) return prev;
      const id = `f_${Date.now().toString(36)}`;
      const figure: StageFigure = {
        id, name: `群演 ${prev.figures.length + 1}`,
        height: DEFAULT_FIGURE_HEIGHT,
        color: FIGURE_COLORS[prev.figures.length % FIGURE_COLORS.length],
      };
      setBlocking((b) => b ? {
        ...b,
        placements: [...b.placements, { figureId: id, x: 1.2, z: 0, rotY: 0, pose: "stand" }],
      } : b);
      return { ...prev, figures: [...prev.figures, figure] };
    });
  }

  function removeFigure(id: string) {
    setScene((prev) => prev ? { ...prev, figures: prev.figures.filter((f) => f.id !== id) } : prev);
    patchBlocking((b) => ({
      ...b,
      placements: b.placements.filter((p) => p.figureId !== id),
      camera: b.camera.subjectFigureId === id
        ? { ...b.camera, subjectFigureId: null }
        : b.camera,
    }));
    if (selectedFigureId === id) setSelectedFigureId(null);
  }

  function addBlock() {
    setScene((prev) => prev ? {
      ...prev,
      blocks: [...prev.blocks, {
        id: `b_${Date.now().toString(36)}`,
        pos: [0, 0.6, -2], size: [2, 1.2, 0.4], rotY: 0, color: "#5b5f70",
        label: `体块 ${prev.blocks.length + 1}`,
      }],
    } : prev);
  }

  // ── 保存 / 导出 ────────────────────────────────────────────────────────
  async function save() {
    if (!scene || !blocking) return;
    setSaving(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/previz-stage`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shotId, scene, blocking }),
        }
      );
      if (!res.ok) throw new Error("保存失败");
      toast.success("已保存摆位");
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function exportLayout() {
    if (!handle.current) return;
    setExporting(true);
    try {
      const height = 720;
      const blob = await handle.current.captureCameraView(Math.round(height * aspect), height);
      if (!blob) throw new Error("渲染失败");
      const form = new FormData();
      form.append("file", new File([blob], "layout.png", { type: "image/png" }));
      const res = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/previz-stage/layout?shotId=${shotId}`,
        { method: "POST", body: form }
      );
      if (!res.ok) throw new Error("上传失败");
      // 顺手把摆位一起存了 —— 导出的图和当时的摆位必须对得上
      await save();
      toast.success("构图参考图已保存到本镜");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  const loading = !scene || !blocking;
  const selPlacement = blocking?.placements.find((p) => p.figureId === selectedFigureId);
  const selFigure = scene?.figures.find((f) => f.id === selectedFigureId);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#101014]">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <span className="text-sm font-medium text-white">3D 导演台</span>
        <span className="text-[11px] text-white/40">
          景是一集共用的，机位和走位每镜独立
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* 深色面板上不能用默认的 outline 配色：那是给浅色背景设计的，文字会隐形 */}
          <Button
            size="xs"
            variant="outline"
            onClick={exportLayout}
            disabled={loading || exporting}
            className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
            存为构图参考图
          </Button>
          <Button size="xs" onClick={save} disabled={loading || saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            保存摆位
          </Button>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左：编辑视角 */}
        <div
          ref={editorRef}
          className="relative min-w-0 flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/50 px-2 py-1 text-[10px] text-white/60">
            编辑视角 · 拖人物改走位，拖空白处环绕，滚轮缩放
          </div>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-white/40">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>

        {/* 右：相机视图 + 控件 */}
        <div className="flex w-[380px] flex-shrink-0 flex-col border-l border-white/10">
          <div className="relative overflow-hidden border-b border-white/10 bg-black" style={{ aspectRatio: String(aspect) }}>
            <div ref={cameraRef} className="h-full w-full" />
            <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/60">
              相机视图 · 导出的就是这一格
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-white">
            {/* 机位 */}
            <section>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">机位</p>
              <div className="mb-2 flex flex-wrap gap-1">
                {(Object.keys(SHOT_SIZE_LABEL) as ShotSize[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => applyShotSize(s)}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      currentShotSize === s ? "bg-primary text-white" : "bg-white/10 text-white/60 hover:bg-white/20"
                    }`}
                  >
                    {SHOT_SIZE_LABEL[s]}
                  </button>
                ))}
              </div>
              {blocking && (
                <div className="space-y-2 text-[11px]">
                  <Slider
                    label="方位角" unit="°"
                    min={-180} max={180} step={5}
                    value={blocking.camera.azimuthDeg}
                    onChange={(v) => patchBlocking((b) => ({ ...b, camera: { ...b.camera, azimuthDeg: v } }))}
                    hint={azimuthHint(blocking.camera.azimuthDeg)}
                  />
                  <Slider
                    label="距离" unit="m"
                    min={0.4} max={20} step={0.1}
                    value={blocking.camera.distance}
                    onChange={(v) => patchBlocking((b) => ({ ...b, camera: { ...b.camera, distance: v } }))}
                  />
                  <Slider
                    label="机位高度" unit="m"
                    min={0.1} max={4} step={0.05}
                    value={blocking.camera.height}
                    onChange={(v) => patchBlocking((b) => ({ ...b, camera: { ...b.camera, height: v } }))}
                    hint={heightHint(blocking.camera.height, subjectHeight)}
                  />
                  <Slider
                    label="焦距" unit="mm"
                    min={16} max={135} step={1}
                    value={fovToFocal(blocking.camera.fov)}
                    onChange={(v) => patchBlocking((b) => ({ ...b, camera: { ...b.camera, fov: focalToFov(v) } }))}
                  />
                  <label className="flex items-center gap-2 text-white/50">
                    主体
                    <select
                      value={blocking.camera.subjectFigureId ?? ""}
                      onChange={(e) => patchBlocking((b) => ({
                        ...b, camera: { ...b.camera, subjectFigureId: e.target.value || null },
                      }))}
                      className="flex-1 rounded bg-white/10 px-1.5 py-0.5 text-white"
                    >
                      <option value="">（原点）</option>
                      {scene?.figures.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </section>

            {/* 演员 */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">演员</p>
                <button onClick={addFigure} className="flex items-center gap-0.5 text-[11px] text-white/50 hover:text-white">
                  <Plus className="h-3 w-3" />加一个
                </button>
              </div>
              <div className="space-y-1">
                {scene?.figures.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFigureId(f.id)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] ${
                      selectedFigureId === f.id ? "bg-white/15" : "hover:bg-white/8"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: f.color }} />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-white/40">
                      {POSE_LABEL[blocking?.placements.find((p) => p.figureId === f.id)?.pose ?? "stand"]}
                    </span>
                    <Trash2
                      className="h-3 w-3 text-white/30 hover:text-red-400"
                      onClick={(e) => { e.stopPropagation(); removeFigure(f.id); }}
                    />
                  </button>
                ))}
              </div>

              {selFigure && selPlacement && (
                <div className="mt-2 space-y-2 rounded bg-white/5 p-2 text-[11px]">
                  <div className="flex flex-wrap gap-1">
                    {(Object.keys(POSE_LABEL) as FigurePose[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => patchPlacement(selFigure.id, { pose: p })}
                        className={`rounded px-1.5 py-0.5 ${
                          selPlacement.pose === p ? "bg-primary text-white" : "bg-white/10 text-white/60 hover:bg-white/20"
                        }`}
                      >
                        {POSE_LABEL[p]}
                      </button>
                    ))}
                  </div>
                  <Slider
                    label="朝向" unit="°"
                    min={-180} max={180} step={5}
                    value={Math.round((selPlacement.rotY * 180) / Math.PI)}
                    onChange={(v) => patchPlacement(selFigure.id, { rotY: (v * Math.PI) / 180 })}
                  />
                  <Slider
                    label="身高" unit="m"
                    min={0.8} max={2.2} step={0.01}
                    value={selFigure.height}
                    onChange={(v) => setScene((prev) => prev ? {
                      ...prev,
                      figures: prev.figures.map((f) => f.id === selFigure.id ? { ...f, height: v } : f),
                    } : prev)}
                  />
                  <button
                    onClick={() => patchPlacement(selFigure.id, { rotY: Math.atan2(
                      -( (blocking?.placements.find(p=>p.figureId===selFigure.id)?.x ?? 0) - camGroundX(blocking, scene) ),
                      -( (blocking?.placements.find(p=>p.figureId===selFigure.id)?.z ?? 0) - camGroundZ(blocking, scene) )
                    ) })}
                    className="flex items-center gap-1 text-white/50 hover:text-white"
                  >
                    <RotateCw className="h-3 w-3" />面向镜头
                  </button>
                </div>
              )}
            </section>

            {/* 场景 */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                  景（本集共用）
                </p>
                <button onClick={addBlock} className="flex items-center gap-0.5 text-[11px] text-white/50 hover:text-white">
                  <Plus className="h-3 w-3" />加体块
                </button>
              </div>
              {scene?.blocks.length === 0 && (
                <p className="text-[11px] text-white/30">
                  只放遮挡与空间结构，不做材质 —— 材质是 Seedance 的活
                </p>
              )}
              <div className="space-y-1">
                {scene?.blocks.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded bg-white/5 px-2 py-1 text-[11px]">
                    <span className="flex-1 truncate text-white/70">{b.label ?? "体块"}</span>
                    <Trash2
                      className="h-3 w-3 cursor-pointer text-white/30 hover:text-red-400"
                      onClick={() => setScene((prev) => prev ? { ...prev, blocks: prev.blocks.filter((x) => x.id !== b.id) } : prev)}
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 小控件 ────────────────────────────────────────────────────────────────

function Slider({
  label, unit, min, max, step, value, onChange, hint,
}: {
  label: string; unit: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-white/50">
        <span>{label}</span>
        <span className="tabular-nums text-white/70">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}{unit}
          {hint ? <span className="ml-1 text-white/35">{hint}</span> : null}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

/** 方位角 → 导演听得懂的说法 */
function azimuthHint(deg: number): string {
  const a = ((deg % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return "正面";
  if (a < 67.5) return "右前四分之三侧";
  if (a < 112.5) return "右正侧";
  if (a < 157.5) return "右后四分之三侧";
  if (a < 202.5) return "背面";
  if (a < 247.5) return "左后四分之三侧";
  if (a < 292.5) return "左正侧";
  return "左前四分之三侧";
}

/** 机位高度 → 相对主体的视角关系 */
function heightHint(h: number, subjectHeight: number): string {
  const eye = subjectHeight * 0.93;
  if (h > eye * 1.25) return "俯拍";
  if (h < eye * 0.55) return "仰拍";
  if (Math.abs(h - eye) < eye * 0.12) return "平视";
  return h > eye ? "略俯" : "略仰";
}

// 「面向镜头」用：相机在地面的投影
function camGroundX(b: PrevizBlocking | null, s: PrevizScene | null): number {
  if (!b) return 0;
  const subj = b.placements.find((p) => p.figureId === b.camera.subjectFigureId);
  const a = (subj?.rotY ?? 0) + (b.camera.azimuthDeg * Math.PI) / 180;
  void s;
  return (subj?.x ?? 0) - Math.sin(a) * b.camera.distance;
}
function camGroundZ(b: PrevizBlocking | null, s: PrevizScene | null): number {
  if (!b) return 0;
  const subj = b.placements.find((p) => p.figureId === b.camera.subjectFigureId);
  const a = (subj?.rotY ?? 0) + (b.camera.azimuthDeg * Math.PI) / 180;
  void s;
  return (subj?.z ?? 0) - Math.cos(a) * b.camera.distance;
}
