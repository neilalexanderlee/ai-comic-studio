import { create } from "zustand";
import { apiFetch } from "@/lib/api-fetch";

interface Character {
  id: string;
  name: string;
  description: string;
  referenceImage: string | null;
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
  lastFrameUrl: string | null;
  sceneRefFrame: string | null;
  videoPrompt: string | null;
  status: string;
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

    const res = await apiFetch(url);
    const data = await res.json();
    set({ project: data, loading: false, currentEpisodeId: episodeId ?? null });
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

  setProject: (project: Project) => {
    set({ project });
  },
}));
