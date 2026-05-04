import {
  detectStructuredStoryboard,
  type StructuredStoryboardDetection,
} from "./detect-structured-storyboard";

export interface ExtractedDialogue {
  character: string;
  text: string;
  sequence: number;
}

export interface ExtractedShot {
  sequence: number;
  sceneTitle?: string | null;
  prompt: string;
  startFrameDesc?: string | null;
  endFrameDesc?: string | null;
  motionScript?: string | null;
  cameraDirection?: string | null;
  duration?: number | null;
  dialogues: ExtractedDialogue[];
  source: "extracted";
  completeness: {
    hasPrompt: boolean;
    hasStartFrame: boolean;
    hasEndFrame: boolean;
    hasMotionScript: boolean;
    hasCameraDirection: boolean;
    hasDuration: boolean;
  };
}

export interface ShotExtractionResult {
  detection: StructuredStoryboardDetection;
  shots: ExtractedShot[];
  warnings: string[];
}

const SCENE_LINE_RE = /^\s*(?:\*{0,2})?(?:SCENE\s*\d+|场景\s*\d+|第\s*\d+\s*场)\b.*$/i;
const SHOT_LINE_RE = /^\s*(?:\*{0,2})?(?:镜头|shot)\s*\d+\b.*$/i;
const TIMECODE_SHOT_RE =
  /^\*{0,2}\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\|(.+?)\s*\*{0,2}\s*$/;
const DIALOGUE_LINE_RE = /^\s*([^：:\n]{1,20})[：:]\s*(.+)$/;

function cleanLabelValue(line: string): string {
  return line
    .replace(/^\s*[-*]?\s*/, "")
    .replace(/\*\*/g, "")
    .trim();
}

function timecodeToSeconds(timecode: string): number {
  const [minutes, seconds] = timecode.split(":").map(Number);
  return minutes * 60 + seconds;
}

function parseDurationSeconds(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)/i) ?? text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.round(value));
}

function buildShot(
  sequence: number,
  sceneTitle: string | null,
  fields: {
    promptParts: string[];
    startFrameParts: string[];
    endFrameParts: string[];
    motionParts: string[];
    combatParts: string[];
    cameraParts: string[];
    duration: number | null;
    dialogues: ExtractedDialogue[];
  }
): ExtractedShot | null {
  const prompt = fields.promptParts.join("\n").trim();
  const startFrameDesc = fields.startFrameParts.join("\n").trim() || null;
  const endFrameDesc = fields.endFrameParts.join("\n").trim() || null;
  const motionSegments = [...fields.motionParts];
  if (fields.combatParts.length > 0) {
    motionSegments.push(...fields.combatParts);
  }
  const motionScript = motionSegments.join("\n").trim() || null;
  const cameraDirection = fields.cameraParts.join(" / ").trim() || null;

  if (!prompt && !motionScript && fields.dialogues.length === 0) {
    return null;
  }

  return {
    sequence,
    sceneTitle,
    prompt: prompt || motionScript || "",
    startFrameDesc,
    endFrameDesc,
    motionScript,
    cameraDirection,
    duration: fields.duration,
    dialogues: fields.dialogues,
    source: "extracted",
    completeness: {
      hasPrompt: !!prompt,
      hasStartFrame: !!startFrameDesc,
      hasEndFrame: !!endFrameDesc,
      hasMotionScript: !!motionScript,
      hasCameraDirection: !!cameraDirection,
      hasDuration: fields.duration !== null,
    },
  };
}

export function extractShotsFromScript(script: string): ShotExtractionResult {
  const detection = detectStructuredStoryboard(script);
  const warnings: string[] = [];
  if (!detection.matched) {
    return { detection, shots: [], warnings };
  }

  const lines = script.split(/\r?\n/);
  const hasStoryboardSection = script.includes("【分镜详情】");
  let inStoryboardSection = !hasStoryboardSection;
  let currentSceneTitle: string | null = null;
  let currentShotFields = {
    promptParts: [] as string[],
    startFrameParts: [] as string[],
    endFrameParts: [] as string[],
    motionParts: [] as string[],
    combatParts: [] as string[],
    cameraParts: [] as string[],
    duration: null as number | null,
    dialogues: [] as ExtractedDialogue[],
  };
  let sequence = 1;
  const shots: ExtractedShot[] = [];
  let currentSection:
    | "prompt"
    | "start"
    | "end"
    | "motion"
    | "combat"
    | "camera"
    | "ignore"
    | null =
    null;

  function flushShot() {
    const shot = buildShot(sequence, currentSceneTitle, currentShotFields);
    if (shot) {
      shots.push(shot);
      sequence += 1;
    }
    currentShotFields = {
      promptParts: [],
      startFrameParts: [],
      endFrameParts: [],
      motionParts: [],
      combatParts: [],
      cameraParts: [],
      duration: null,
      dialogues: [],
    };
    currentSection = null;
  }

  for (const rawLine of lines) {
    const rawTrimmed = rawLine.trim();
    if (hasStoryboardSection && rawTrimmed.includes("【分镜详情】")) {
      inStoryboardSection = true;
      continue;
    }

    if (
      inStoryboardSection &&
      /^(?:##\s*第\s*\d+\s*集|\*\*【(?:打戏分镜汇总|本集重点画面清单|打戏分镜设计)】\*\*)/.test(
        rawTrimmed
      )
    ) {
      flushShot();
      inStoryboardSection = false;
      currentSection = null;
      continue;
    }

    if (!inStoryboardSection) continue;

    const line = cleanLabelValue(rawLine);
    if (!line) continue;

    const timecodeMatch = rawTrimmed.match(TIMECODE_SHOT_RE);
    if (timecodeMatch) {
      flushShot();
      currentSceneTitle = timecodeMatch[3].trim();
      currentShotFields.duration =
        timecodeToSeconds(timecodeMatch[2]) - timecodeToSeconds(timecodeMatch[1]);
      continue;
    }

    if (SCENE_LINE_RE.test(line)) {
      currentSceneTitle = line;
      continue;
    }

    if (SHOT_LINE_RE.test(line)) {
      flushShot();
      continue;
    }

    const bareFieldMatch = line.match(
      /^(?:【)?(画面|场景|环境|镜头画面|首帧|开镜|尾帧|结尾画面|结尾镜头|结尾特写|动作|表演|过程|镜头|打戏分镜|运镜|镜头运动|音效|字幕|时长|台词|对白|对话)(?:】)?$/
    );
    if (bareFieldMatch) {
      const [, rawLabel] = bareFieldMatch;
      switch (rawLabel) {
        case "画面":
        case "场景":
        case "环境":
        case "镜头画面":
          currentSection = "prompt";
          break;
        case "首帧":
        case "开镜":
          currentSection = "start";
          break;
        case "尾帧":
        case "结尾画面":
        case "结尾镜头":
        case "结尾特写":
          currentSection = "end";
          break;
        case "动作":
        case "表演":
        case "过程":
        case "镜头":
          currentSection = "motion";
          break;
        case "打戏分镜":
          currentSection = "combat";
          break;
        case "运镜":
        case "镜头运动":
          currentSection = "camera";
          break;
        case "音效":
        case "字幕":
          currentSection = "ignore";
          break;
        case "台词":
        case "对白":
        case "对话":
          currentSection = null;
          break;
        default:
          currentSection = null;
          break;
      }
      continue;
    }

    const labeledFieldMatch = line.match(
      /^(?:【)?(画面|场景|环境|镜头画面|首帧|开镜|尾帧|结尾画面|结尾镜头|结尾特写|动作|表演|过程|镜头|打戏分镜|运镜|镜头运动|音效|字幕|时长|台词|对白|对话)(?:】)?\s*[：:]\s*(.*)$/i
    );
    if (labeledFieldMatch) {
      const [, rawLabel, rawValue] = labeledFieldMatch;
      const value = rawValue.trim();
      switch (rawLabel) {
        case "画面":
        case "场景":
        case "环境":
        case "镜头画面":
          currentSection = "prompt";
          if (value) currentShotFields.promptParts.push(value);
          break;
        case "首帧":
        case "开镜":
          currentSection = "start";
          if (value) currentShotFields.startFrameParts.push(value);
          break;
        case "尾帧":
        case "结尾画面":
          currentSection = "end";
          if (value) currentShotFields.endFrameParts.push(value);
          break;
        case "动作":
        case "表演":
        case "过程":
        case "镜头":
          currentSection = "motion";
          if (value) currentShotFields.motionParts.push(value);
          break;
        case "打戏分镜":
          currentSection = "combat";
          if (value) currentShotFields.combatParts.push(value);
          break;
        case "结尾镜头":
        case "结尾特写":
          currentSection = "end";
          if (value) currentShotFields.endFrameParts.push(value);
          break;
        case "运镜":
        case "镜头运动":
          currentSection = "camera";
          if (value) currentShotFields.cameraParts.push(value);
          break;
        case "音效":
        case "字幕":
          currentSection = "ignore";
          break;
        case "时长": {
          const seconds = parseDurationSeconds(value);
          if (seconds !== null) currentShotFields.duration = seconds;
          else warnings.push(`Could not parse duration from "${line}"`);
          currentSection = null;
          break;
        }
        case "台词":
        case "对白":
        case "对话": {
          currentSection = null;
          if (value) {
            const dialogueMatch = value.match(DIALOGUE_LINE_RE);
            if (dialogueMatch) {
              currentShotFields.dialogues.push({
                character: dialogueMatch[1].trim(),
                text: dialogueMatch[2].trim(),
                sequence: currentShotFields.dialogues.length,
              });
            }
          }
          break;
        }
      }
      continue;
    }

    const dialogueMatch = line.match(DIALOGUE_LINE_RE);
    if (
      dialogueMatch &&
      !["prompt", "start", "end", "motion", "combat", "camera", "ignore"].includes(
        currentSection ?? ""
      )
    ) {
      currentShotFields.dialogues.push({
        character: dialogueMatch[1].trim(),
        text: dialogueMatch[2].trim(),
        sequence: currentShotFields.dialogues.length,
      });
      continue;
    }

    switch (currentSection) {
      case "prompt":
        currentShotFields.promptParts.push(line);
        break;
      case "start":
        currentShotFields.startFrameParts.push(line);
        break;
      case "end":
        currentShotFields.endFrameParts.push(line);
        break;
      case "motion":
        currentShotFields.motionParts.push(line);
        break;
      case "combat":
        currentShotFields.combatParts.push(line);
        break;
      case "camera":
        currentShotFields.cameraParts.push(line);
        break;
      case "ignore":
        break;
      default:
        if (currentShotFields.promptParts.length === 0) {
          currentShotFields.promptParts.push(line);
        } else {
          currentShotFields.motionParts.push(line);
        }
        break;
    }
  }

  flushShot();

  if (shots.length === 0) {
    warnings.push("Structured storyboard detected but no shots were extracted");
  }

  return { detection, shots, warnings };
}
