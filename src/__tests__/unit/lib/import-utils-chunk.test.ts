import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, chunkText, mapWithConcurrency } from "@/lib/import-utils";

describe("chunkText", () => {
  it("普通短文本保持单块", () => {
    expect(chunkText("第一段\n\n第二段")).toEqual(["第一段\n\n第二段"]);
  });

  it("没有段落分隔的超长文本也会硬切", () => {
    const text = "字".repeat(CHUNK_SIZE * 2 + 17);
    const chunks = chunkText(text);

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= CHUNK_SIZE)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });
});

describe("mapWithConcurrency", () => {
  it("限制并发并保持输入顺序", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency([40, 10, 30, 20], 2, async (delay, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return index;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([0, 1, 2, 3]);
  });
});
