/**
 * 结构性防回归：**schema 里每一个存产物引用的列，都必须被 `REF_COLUMNS` 覆盖**。
 *
 * 这份清单不只给审计用 —— `storage-migrate` / `prune-orphan-files` /
 * `verify-editor-state-refs` 都读它。漏一列的后果按严重度递增：
 *   1. 审计看不见它（报告全绿，其实有悬空引用）
 *   2. 存量迁移不迁它（本地副本清理后界面上图裂）
 *   3. **孤儿清理把正在用的文件当成没人引用，直接删掉**
 *
 * 第 3 条真实发生过（`episodes.editor_state` 里内嵌的路径没被扫，差点删掉时间线
 * 正在用的 6 个 BGM）。2026-09-04 做备份恢复演练时发现 migration 0059/0060 的
 * 三列又漏了同一个口子 —— 靠人记显然不行，改成让测试盯着。
 */
import { describe, it, expect, vi } from "vitest";

// 全局 setup mock 了 node:fs；这里要读真实源码文件
vi.mock("node:fs", async (importOriginal) => importOriginal());

import fs from "node:fs";
import path from "node:path";
import { REF_COLUMNS } from "../../../../scripts/storage-audit";

/** 不属于「我们自己的产物」的列，必须逐条写明理由。「以后再说」不是理由。 */
const NOT_OUR_ARTIFACTS: Record<string, string> = {
  "shots.anchor_first_remote_url": "上游模型返回的临时 URL，不是我们存的产物，会自然失效",
  "shots.anchor_last_ai_remote_url": "同上",
  "shots.remote_video_url": "同上",
};

function schemaArtifactColumns(): string[] {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/lib/db/schema.ts"), "utf-8");
  const out: string[] = [];
  let table: string | null = null;
  for (const line of src.split("\n")) {
    const t = /export const \w+ = sqliteTable\("(\w+)"/.exec(line);
    if (t) table = t[1];
    const c = /text\("(\w*(?:url|path|image)\w*)"\)/i.exec(line);
    if (c && table) out.push(`${table}.${c[1]}`);
  }
  return out;
}

describe("产物引用列清单", () => {
  const covered = new Set(REF_COLUMNS.map(([t, c]) => `${t}.${c}`));

  it("扫描到了 schema 里的产物列（防止扫描逻辑本身失效）", () => {
    expect(schemaArtifactColumns().length).toBeGreaterThan(10);
  });

  it.each(schemaArtifactColumns())("%s 在 REF_COLUMNS 里（或已登记为非产物列）", (col) => {
    if (col in NOT_OUR_ARTIFACTS) {
      expect(NOT_OUR_ARTIFACTS[col].length).toBeGreaterThan(0);
      return;
    }
    expect(
      covered.has(col),
      `列 ${col} 存的是产物引用却不在 scripts/storage-audit.ts 的 REF_COLUMNS 里。` +
        `孤儿清理会把它引用的文件当成没人用而删掉 —— 请加进清单，` +
        `或在本测试的 NOT_OUR_ARTIFACTS 里登记理由。`,
    ).toBe(true);
  });

  it("清单里的每一条都还存在于 schema（防止僵尸配置）", () => {
    const inSchema = new Set(schemaArtifactColumns());
    // anchor_first / anchor_last_ai / cut_point 这类不带 url/path 后缀的列不在扫描口径内
    for (const c of covered) {
      if (!/(url|path|image)/i.test(c)) continue;
      expect(inSchema.has(c), `REF_COLUMNS 里的 ${c} 在 schema 中已不存在`).toBe(true);
    }
  });
});
