/** Versioned composition semantics shared by preview and export. */
export const COMPOSITION_VERSION = 2;
export const TRANSITIONS = {
  fade: "fadeblack",
  dissolve: "fade",
  "slide-left": "slideleft",
  "slide-right": "slideright",
  "slide-up": "slideup",
  "slide-down": "slidedown",
  "wipe-left": "wipeleft",
  "wipe-right": "wiperight",
  "zoom-in": "zoomin",
  "zoom-out": "custom",
  blur: "hblur",
  pixelate: "pixelize",
  circle: "circleopen",
} as const;
export type TransitionName = keyof typeof TRANSITIONS;
export const EFFECTS = [
  "fadeIn",
  "fadeOut",
  "flash",
  "shake",
  "zoomIn",
  "zoomOut",
  "pulse",
  "rotateIn",
] as const;
export type EffectName = (typeof EFFECTS)[number];
export interface RenderTransition {
  beforeClipId?: string;
  afterClipId?: string;
  track: number;
  startTime: number;
  endTime: number;
  transitionType: TransitionName;
}
export function transitionFilter(type: TransitionName, duration: number) {
  const name = TRANSITIONS[type];
  if (!name) throw new Error(`未知转场：${type}`);
  if (type === "zoom-out") {
    const inside =
      "between(X,W*(1-P)/2,W*(1+P)/2)*between(Y,H*(1-P)/2,H*(1+P)/2)";
    const sample = "a0((X-W/2)/max(P,0.001)+W/2,(Y-H/2)/max(P,0.001)+H/2)";
    // PLANE selects the matching component when sampling the shrinking outgoing frame.
    const channel = [0, 1, 2, 3].reduceRight(
      (rest, n) =>
        `if(eq(PLANE,${n}),${sample.replace("a0", `a${n}`)},${rest})`,
      "A",
    );
    return `xfade=transition=custom:duration=${duration}:offset=0:expr='if(${inside},${channel}*P+B*(1-P),B)'`;
  }
  return `xfade=transition=${name}:duration=${duration}:offset=0`;
}

/** Effects operate in clip-local seconds on an RGBA frame at the output canvas size. */
export function effectFilters(
  input: string,
  output: string,
  effect: EffectName | undefined,
  duration: number,
  width: number,
  height: number,
  fps: number,
): string[] {
  if (!effect) return [`[${input}]null[${output}]`];
  if (!(EFFECTS as readonly string[]).includes(effect))
    throw new Error(`未知画面特效：${effect}`);
  const p = `min(1,t/${duration})`;
  if (effect === "fadeIn" || effect === "fadeOut")
    return [
      `[${input}]fade=t=${effect === "fadeIn" ? "in" : "out"}:st=0:d=${duration}:alpha=1[${output}]`,
    ];
  if (effect === "flash")
    return [
      `[${input}]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*abs(sin(T/${duration}*PI*4))'[${output}]`,
    ];
  if (effect === "rotateIn")
    return [
      `[${input}]rotate='(1-${p})*2*PI':c=none:ow=iw:oh=ih,fade=t=in:st=0:d=${duration}:alpha=1[${output}]`,
    ];
  const scale =
    effect === "zoomIn"
      ? `.5+.5*${p}`
      : effect === "zoomOut"
        ? `1.5-.5*${p}`
        : effect === "pulse"
          ? `1+.05*sin(${p}*PI*6)`
          : "1";
  const x =
    effect === "shake"
      ? `(W-w)/2+sin(${p}*PI*8)*${(10 * width) / 1920}*(1-${p})`
      : "(W-w)/2";
  return [
    `[${input}]scale=w='max(2,trunc(iw*(${scale})/2)*2)':h='max(2,trunc(ih*(${scale})/2)*2)':eval=frame[${output}s]`,
    `color=c=black@0:s=${width}x${height}:r=${fps}:d=${duration},format=rgba[${output}b]`,
    `[${output}b][${output}s]overlay=x='${x}':y='(H-h)/2':format=auto:shortest=1[${output}]`,
  ];
}
