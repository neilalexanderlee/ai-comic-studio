-- shots: store locally-downloaded copy of Seedance video's true last frame
ALTER TABLE `shots` ADD `seedance_last_frame` text;
--> statement-breakpoint
-- dialogues: per-line voice hint override (optional, falls back to character voice_hint)
ALTER TABLE `dialogues` ADD `voice_hint` text;
--> statement-breakpoint
-- characters: voice characteristic hint auto-generated during character extraction
-- Format: 性别+年龄区间+声音属性+语速+情绪基线
-- Example: "男性，约25岁，声音低沉沙哑，语速缓慢，情绪压抑克制"
ALTER TABLE `characters` ADD `voice_hint` text DEFAULT '';
