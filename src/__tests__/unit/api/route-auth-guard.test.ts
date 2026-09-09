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
  "requireAdmin",
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
  "billing/callback/[channel]/route.ts":
    "支付渠道异步回调：请求来自渠道服务器而不是浏览器，没有用户会话。" +
    "身份由渠道签名证明（verifySignature），入账本身幂等（UNIQUE(channel, channel_trade_no) 兜底）。",
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

  /**
   * 光"提到"鉴权助手不算数 —— 返回值必须真的被用上。
   *
   * 起因是一条真实漏洞：`projects/[id]/shots/[shotId]/split/route.ts` 里写着
   *     getUserIdFromRequest(request); // auth check (throws if missing)
   * 注释是错的（该函数从不抛异常，只返回空串），返回值又被丢弃 ——
   * 于是知道 projectId + shotId 就能把别人的分镜拆掉，而上面那条按标志词扫描的
   * 测试**照样是绿的**。所以这里补一条：不允许把鉴权函数当成裸语句调用。
   */
  it.each(routeFiles.map((r) => [r.rel, r.abs] as const))(
    "%s 没有把鉴权函数的返回值丢掉",
    (rel, abs) => {
      const src = fs.readFileSync(abs, "utf-8");
      if (!HTTP_HANDLER.test(src)) return;
      // 只认「整句就是一次调用、紧跟分号」这种形态 —— 即返回值确实被丢掉了。
      // 作为参数或表达式一部分出现在行首的（多行调用的续行）不算。
      const discarded = AUTH_MARKERS.flatMap((m) => {
        const re = new RegExp(`^[ \\t]*(?:await\\s+)?${m}\\s*\\([^)]*\\)\\s*;`, "gm");
        return src.match(re) ?? [];
      });
      expect(
        discarded,
        `路由 ${rel} 把鉴权函数当成裸语句调用了，返回值没被使用。` +
          `请改成 const guard = await requireProjectOwner(...); if (!guard.ok) return guard.response;`
      ).toEqual([]);
    }
  );

  /**
   * **身份 ≠ 归属。** 路径里带 `[id]`（projectId）的路由，光识别出「你是谁」不算数 ——
   * 必须再回溯一次「这个项目是不是你的」。
   *
   * 起因是三条真实漏洞（2026-09-09 一次性发现并修掉）：
   *   · `shots/[shotId]/enhance` —— 只用 `getUserIdFromRequest` 查了一下密钥，
   *     知道 projectId + shotId 就能对别人的分镜跑一次画质增强（花的是 Key 的钱）
   *   · `episodes/[episodeId]/editor-state` —— 能读走、还能覆盖别人整条剪辑时间线
   *   · `characters/.../lock-to-ark` —— 能把别人的角色图注册进自己的方舟素材库，
   *     顺带改掉对方那条资产的状态
   *
   * 三条**都通过了**上面两条测试：它们确实调了鉴权函数、返回值也确实被用了 ——
   * 只是没有用来鉴权。所以标志词扫描这一层，对「带 projectId 的路由」必须更严。
   *
   * 认可的归属证明有两种：接 `requireProjectOwner` / `requireTaskOwner`，
   * 或自己写一条带 `projects.userId` 的查询（`generate/route.ts` 等就是这么做的）。
   */
  const OWNERSHIP_MARKERS = ["requireProjectOwner", "requireTaskOwner", "projects.userId"];

  /** 带 projectId 却确实不需要归属校验的，在这里登记理由。 */
  const NO_OWNERSHIP_ALLOWLIST: Record<string, string> = {};

  const projectScopedRoutes = routeFiles.filter((r) => r.rel.startsWith("projects/[id]/"));

  it("扫描到了带 projectId 的路由（防止过滤条件本身失效导致空跑）", () => {
    expect(projectScopedRoutes.length).toBeGreaterThan(20);
  });

  it.each(projectScopedRoutes.map((r) => [r.rel, r.abs] as const))(
    "%s 校验了项目归属，而不只是识别身份",
    (rel, abs) => {
      const src = fs.readFileSync(abs, "utf-8");
      if (!HTTP_HANDLER.test(src)) return;

      if (rel in NO_OWNERSHIP_ALLOWLIST) {
        expect(NO_OWNERSHIP_ALLOWLIST[rel].length).toBeGreaterThan(0);
        return;
      }

      const proven = OWNERSHIP_MARKERS.some((m) => src.includes(m));
      expect(
        proven,
        `路由 ${rel} 只识别了身份，没有回溯「这个项目属不属于当前用户」。\n` +
          `请接 requireProjectOwner(request, projectId)，或在查询里带上 projects.userId；\n` +
          `路径里还带子资源 id 的（characterId / shotId / assetId），再过一次 requireXxxInProject。`
      ).toBe(true);
    }
  );

  it("归属豁免名单里的每一条都必须仍然存在", () => {
    const all = new Set(routeFiles.map((r) => r.rel));
    for (const rel of Object.keys(NO_OWNERSHIP_ALLOWLIST)) {
      expect(all.has(rel), `豁免名单里的 ${rel} 已不存在，请移除`).toBe(true);
    }
  });

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
