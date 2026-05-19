import { create } from "zustand";
import { apiFetch } from "@/lib/api-fetch";

interface Character {
  id: string;
  name: string;
  description: string;
  assets: {
    id: string;
    imagePath: string | null;
    tag: string;
    assetType: "morph" | "blueprint";
    isDefault: number;
  }[];
  visualHint?: string | null;
  scope?: string;
  episodeId?: string | null;
}

interface Dialogue {
  id: string;
  text: string;
  characterId: string;
  characterName: string;
  sequence: number;
}

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  referenceVideoUrl: string | null;
  remoteVideoUrl: string | null;
  remoteVideoStatus: string | null;
  remoteVideoExpiresAt: string | null;
  remoteVideoLastDownloadAt: string | null;
  remoteReferenceVideoUrl: string | null;
  remoteReferenceVideoStatus: string | null;
  remoteReferenceVideoExpiresAt: string | null;
  remoteReferenceVideoLastDownloadAt: string | null;
  lastFrameUrl: string | null;
  sceneRefFrame: string | null;
  videoPrompt: string | null;
  status: string;
  warnings?: string | null;
  videoResolution?: string | null;
  seedanceLastFrame?: string | null;
  dialogues: Dialogue[];
}

export type StoryboardVersion = {
  id: string;
  label: string;
  versionNum: number;
  createdAt: number;
};

interface Project {
  id: string;
  title: string;
  idea: string;
  script: string;
  status: string;
  finalVideoUrl: string | null;
  generationMode: "keyframe" | "reference";
  visualStyle: string;
  characters: Character[];
  shots: Shot[];
  versions: StoryboardVersion[];
}

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  currentEpisodeId: string | null;
  fetchProject: (id: string, episodeId?: string, versionId?: string) => Promise<void>;
  updateIdea: (idea: string) => void;
  updateScript: (script: string) => void;
  updateVisualStyle: (visualStyle: string) => void;
  setProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  loading: false,
  currentEpisodeId: null,

  fetchProject: async (id: string, episodeId?: string, versionId?: string) => {
    // Only show loading spinner on initial load (no project yet).
    // Version switches are background refreshes — don't unmount children.
    if (!get().project) set({ loading: true });

    let url: string;
    if (episodeId) {
      url = `/api/projects/${id}/episodes/${episodeId}${versionId ? `?versionId=${versionId}` : ""}`;
    } else {
      url = `/api/projects/${id}${versionId ? `?versionId=${versionId}` : ""}`;
    }

    try {
      const res = await apiFetch(url);
      const data = await res.json();
      set({ project: data, loading: false, currentEpisodeId: episodeId ?? null });
    } catch (err) {
      // Reset loading state so UI doesn't get stuck on spinner
      set({ loading: false });
      throw err;
    }
  },

  updateIdea: (idea: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, idea } : null,
    }));
  },

  updateScript: (script: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, script } : null,
    }));
  },

  updateVisualStyle: (visualStyle: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, visualStyle } : null,
    }));
  },

  setProject: (project: Project) => {
    set({ project });
  },
}));
