import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/get-user-id", () => ({
  getUserIdFromRequest: () => "test-user",
}));

vi.mock("@/lib/provider-secrets", () => ({
  hydrateModelConfigSecrets: async (_userId: string, config: unknown) => config,
}));

const ownerSelectWhere = vi.fn().mockResolvedValue([{ id: "proj-1" }]);

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: ownerSelectWhere,
      })),
    })),
  },
}));

import { POST } from "@/app/api/projects/[id]/generate/route";

function makeRequest(action: string) {
  return new Request("http://localhost/api/projects/proj-1/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": "test-user",
    },
    body: JSON.stringify({ action, payload: {} }),
  });
}

describe("POST /api/projects/[id]/generate contract", () => {
  beforeEach(() => {
    ownerSelectWhere.mockResolvedValue([{ id: "proj-1" }]);
  });

  it("returns 404 when project not owned", async () => {
    ownerSelectWhere.mockResolvedValueOnce([]);
    const res = await POST(makeRequest("batch_frame_generate"), {
      params: Promise.resolve({ id: "proj-1" }),
    });
    expect(res.status).toBe(404);
  });

  it.each(["batch_frame_generate", "batch_video_generate", "frame_generate"])(
    "returns 410 for deprecated action %s",
    async (action) => {
      const res = await POST(makeRequest(action), {
        params: Promise.resolve({ id: "proj-1" }),
      });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    }
  );
});
