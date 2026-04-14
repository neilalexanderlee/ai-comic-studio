export interface BuiltInPreset {
  id: string;
  name: string;
  nameKey: string;
  descriptionKey: string;
  promptKey: string;
  slots: Record<string, string>;
}

// Empty for now — preset content will be authored later
export const BUILT_IN_PRESETS: BuiltInPreset[] = [];
