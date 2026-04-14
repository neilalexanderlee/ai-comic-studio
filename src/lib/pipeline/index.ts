import { registerHandlers } from "@/lib/task-queue";
import { handleScriptParse } from "./script-parse";
import { handleCharacterExtract } from "./character-extract";
import { handleCharacterImage } from "./character-image";
import { handleShotSplit } from "./shot-split";
import { handleFrameGenerate } from "./frame-generate";
import { handleVideoGenerate } from "./video-generate";
import { handleVideoAssemble } from "./video-assemble";

export function registerPipelineHandlers() {
  registerHandlers({
    script_parse: handleScriptParse,
    character_extract: handleCharacterExtract,
    character_image: handleCharacterImage,
    shot_split: handleShotSplit,
    frame_generate: handleFrameGenerate,
    video_generate: handleVideoGenerate,
    video_assemble: handleVideoAssemble,
  });
}
