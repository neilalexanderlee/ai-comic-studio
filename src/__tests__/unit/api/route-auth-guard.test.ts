/**
 * 结构性防回归测试：**任何 API 路由都必须做用户识别**。
 *
 * 背景（CLAUDE.md 已知陷阱表有记录）：只有 `projects` 表有 `user_id`，其余表全靠
 * `project_id` 级联。一期加固前有 26 / 65 个路由既不识别用户也不校验归属，
 * 知道一个 project ULID 就能读写别人的分镜、角色、上传文件、整包下载。
 *
 * 本测试扫描 `src/app/api/**​/route.ts`：任何导出了 HTTP handler 的文件，
 * 若既不在白名单里、又没调用任何鉴权助手 → 直接失败。
 *
 * 新增路由时要么接上 `requireProjectOwner` / `requireUser`（见 `src/lib/api-guard.ts`），
 * 要么在下面的白名单里显式登记并写清楚为什么不需要鉴权。
 */

import { describe, it, expect, vi } from "vitest";

// 全局 setup.ts mock 了 node:fs；本测试要扫真实源码文件，必须用回真实 fs
vi.mock("node:fs", async (importOriginal) => importOriginal());

import fs from "node:fs";
import path from "node:path";

const API_ROOT = path.resolve(process.cwd(), "src/app/api");

/** 认定「这个路由做了鉴权」的标志函数 */
const AUTH_MARKERS = [
  "requireProjectOwner",
  "requireTaskOwner",
  "requireUser",
  "getUserIdFromRequest",
  "getAuthUserIdFromRequest",
  "getFreshAuthUserId",
];

/**
 * 显式豁免清单。加进来必须写明理由 —— 「暂时先放着」不是理由。
 * key 是相对 src/app/api 的路径。
 */
const NO_AUTH_ALLOWLIST: Record<string, string> = {
  "auth/login/route.ts": "登录入口，鉴权前的端点",
  "auth/logout/route.ts": "登出入口，只清 cookie",
  "auth/register/route.ts": "注册入口，鉴权前的端点",
  "prompt-templates/registry/route.ts": "只返回内置提示词注册表常量，不读任何用户数据",
  "prompt-templates/preview/route.ts": "纯函数：按传入 slots 拼装提示词，不读库不调用 AI",
  "prompt-templates/validate/route.ts": "纯函数：校验提示词模板格式，不读库不调用 AI",
};

function listRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, acc);
    else if (entry.name === "route.ts") acc.push(full);
  }
  return acc;
}

const HTTP_HANDLER = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/;

const routeFiles = listRouteFiles(API_ROOT).map((abs) => ({
  abs,
  rel: path.relative(API_ROOT, abs).split(path.sep).join("/"),
}));

describe("API 路由鉴权守卫", () => {
  it("扫描到了路由文件（防止扫描逻辑本身失效导致测试空跑）", () => {
    expect(routeFiles.length).toBeGreaterThan(50);
  });

  it.each(routeFiles.map((r) => [r.rel, r.abs] as const))(
    "%s 做了用户识别（或在白名单里）",
    (rel, abs) => {
      const src = fs.readFileSync(abs, "utf-8");
      if (!HTTP_HANDLER.test(src)) return; // 没有导出 handler 的文件跳过

      if (rel in NO_AUTH_ALLOWLIST) {
        expect(NO_AUTH_ALLOWLIST[rel].length).toBeGreaterThan(0);
        return;
      }

      const guarded = AUTH_MARKERS.some((m) => src.includes(m));
      expect(
        guarded,
        `路由 ${rel} 没有调用任何鉴权助手。请接上 requireProjectOwner / requireUser` +
          `（src/lib/api-guard.ts），或在本测试的 NO_AUTH_ALLOWLIST 里登记并说明理由。`
      ).toBe(true);
    }
  );

  it("白名单里的每一条都必须仍然存在（防止豁免项变成僵尸配置）", () => {
    const all = new Set(routeFiles.map((r) => r.rel));
    for (const rel of Object.keys(NO_AUTH_ALLOWLIST)) {
      expect(all.has(rel), `白名单里的 ${rel} 已不存在，请从 NO_AUTH_ALLOWLIST 移除`).toBe(true);
    }
  });
});

describe("已删除的 reclaim 数据继承逻辑不得复活", () => {
  it("全仓不再引用 reclaimLocalProjectsForUser", () => {
    // 这套逻辑会把「数据库里项目最多的孤儿匿名用户」的全部数据（含 provider_secrets
    // 里的 API Key）自动过继给下一个空手到访的访客，公网部署下是数据泄露开关。
    const srcRoot = path.resolve(process.cwd(), "src");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const text = fs.readFileSync(full, "utf-8");
          if (text.includes("reclaimLocalProjectsForUser")) {
            hits.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);
    // 本测试文件自身不算（它只是在字符串里提到这个名字）
    expect(hits.filter((h) => !h.includes("route-auth-guard.test"))).toEqual([]);
  });
});
