import { create } from "zustand";

interface SlotMeta {
  key: string;
  nameKey: string;
  descriptionKey: string;
  defaultContent: string;
  editable: boolean;
}

interface PromptMeta {
  key: string;
  nameKey: string;
  descriptionKey: string;
  category: string;
  slots: SlotMeta[];
}

interface PromptTemplateStore {
  // Registry data (fetched from server)
  registry: PromptMeta[];
  setRegistry: (registry: PromptMeta[]) => void;

  // Current selection
  selectedPromptKey: string | null;
  selectedSlotKey: string | null;
  selectPrompt: (key: string) => void;
  selectSlot: (key: string) => void;

  // Editor mode
  mode: "slots" | "advanced";
  setMode: (mode: "slots" | "advanced") => void;

  // Slot editing (local edits before save)
  editedSlots: Record<string, Record<string, string>>; // promptKey -> slotKey -> content
  setSlotContent: (promptKey: string, slotKey: string, content: string) => void;
  resetSlot: (promptKey: string, slotKey: string) => void;
  clearEdits: (promptKey: string) => void;

  // Full-text editing (advanced mode)
  fullTextContent: string;
  setFullTextContent: (content: string) => void;

  // Server overrides (fetched from API)
  serverOverrides: Record<string, Record<string, string>>; // promptKey -> slotKey -> content
  setServerOverrides: (overrides: Array<{ promptKey: string; slotKey: string | null; content: string }>) => void;

  // Get effective content for a slot (edited > server override > default)
  getSlotContent: (promptKey: string, slotKey: string) => string;

  // Dirty tracking
  isDirty: (promptKey: string) => boolean;
  dirtySlots: (promptKey: string) => string[];

  // Category filter
  categoryFilter: string;
  setCategoryFilter: (cat: string) => void;

  // Customized prompts (which prompts have server overrides)
  getCustomizedPromptKeys: () => string[];
}

export const usePromptTemplateStore = create<PromptTemplateStore>()((set, get) => ({
  registry: [],
  setRegistry: (registry) => set({ registry }),

  selectedPromptKey: null,
  selectedSlotKey: null,
  selectPrompt: (key) => {
    const reg = get().registry.find((r) => r.key === key);
    const firstEditable = reg?.slots.find((s) => s.editable);
    set({
      selectedPromptKey: key,
      selectedSlotKey: firstEditable?.key ?? null,
      mode: "slots",
      fullTextContent: "",
    });
  },
  selectSlot: (key) => set({ selectedSlotKey: key }),

  mode: "slots",
  setMode: (mode) => set({ mode }),

  editedSlots: {},
  setSlotContent: (promptKey, slotKey, content) =>
    set((state) => ({
      editedSlots: {
        ...state.editedSlots,
        [promptKey]: {
          ...(state.editedSlots[promptKey] ?? {}),
          [slotKey]: content,
        },
      },
    })),
  resetSlot: (promptKey, slotKey) =>
    set((state) => {
      const updated = { ...(state.editedSlots[promptKey] ?? {}) };
      delete updated[slotKey];
      return {
        editedSlots: { ...state.editedSlots, [promptKey]: updated },
      };
    }),
  clearEdits: (promptKey) =>
    set((state) => {
      const updated = { ...state.editedSlots };
      delete updated[promptKey];
      return { editedSlots: updated };
    }),

  fullTextContent: "",
  setFullTextContent: (content) => set({ fullTextContent: content }),

  serverOverrides: {},
  setServerOverrides: (overrides) => {
    const map: Record<string, Record<string, string>> = {};
    for (const o of overrides) {
      const key = o.slotKey ?? "__full__";
      if (!map[o.promptKey]) map[o.promptKey] = {};
      map[o.promptKey][key] = o.content;
    }
    set({ serverOverrides: map });
  },

  getSlotContent: (promptKey, slotKey) => {
    const state = get();
    // Priority: local edit > server override > default
    const edited = state.editedSlots[promptKey]?.[slotKey];
    if (edited !== undefined) return edited;
    const override = state.serverOverrides[promptKey]?.[slotKey];
    if (override !== undefined) return override;
    const def = state.registry.find((r) => r.key === promptKey);
    const slot = def?.slots.find((s) => s.key === slotKey);
    return slot?.defaultContent ?? "";
  },

  isDirty: (promptKey) => {
    const edited = get().editedSlots[promptKey];
    return !!edited && Object.keys(edited).length > 0;
  },
  dirtySlots: (promptKey) => {
    const edited = get().editedSlots[promptKey];
    return edited ? Object.keys(edited) : [];
  },

  categoryFilter: "all",
  setCategoryFilter: (cat) => set({ categoryFilter: cat }),

  getCustomizedPromptKeys: () => {
    return Object.keys(get().serverOverrides);
  },
}));
