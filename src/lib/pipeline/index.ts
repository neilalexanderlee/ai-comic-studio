import { registerHandlers } from "@/lib/task-queue";
import { handleScriptParse } from "./script-parse";
import { handleCharacterExtract } from "./character-extract";
import { handleCharacterImage } from "./character-image";
import { handleVideoAssemble } from "./video-assemble";

export function registerPipelineHandlers() {
  registerHandlers({
    script_parse: handleScriptParse,
    character_extract: handleCharacterExtract,
    character_image: handleCharacterImage,
    video_assemble: handleVideoAssemble,
  });
}
