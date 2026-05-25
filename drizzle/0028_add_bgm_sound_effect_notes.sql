-- Migration 0028: add bgm_note and sound_effect_note to shots
-- bgm_note:        BGM 注记（仅后期参考，不注入视频生成）
-- sound_effect_note: 场景级音效提示（注入视频生成 prompt）
ALTER TABLE shots ADD COLUMN bgm_note TEXT;
ALTER TABLE shots ADD COLUMN sound_effect_note TEXT;
