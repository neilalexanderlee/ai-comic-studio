import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// 全局 setup.ts 把 `node:fs` 整个 mock 掉了（所有 readFileSync 返回 ""），
// 这里需要真读磁盘 —— 与 prompt-templates-deplot.test.ts 同一模式。
vi.mock("node:fs", async (importOriginal) => importOriginal());

/**
 * 登录 / 注册 / 退出之后**必须整页重载**，不能用 `router.push` / `replace` / `refresh`。
 *
 * 这条不是风格偏好，是一个真实事故的回归守卫（2026-09-11）：
 *
 * 根 layout(`[locale]/layout.tsx`) 里挂着 `ModelStoreServerSync` 这类
 * 「mount 时拉一次属于我的数据」的客户端组件。登录页也在这个 layout 下面，
 * 于是那次拉取发生在**还没登录**的时候，必然 401。而 `router.replace` 是客户端跳转，
 * 客户端组件不卸载 → `useEffect(..., [])` 不重跑 → 登录之后整个会话都停留在
 * 匿名那次的空结果上。症状：隐身窗口首次登录，设置页四个默认模型下拉框只有一个
 * 「--」、平台托管模式也判成 false，**刷新一下全好**。
 *
 * 老浏览器因为 localStorage 里有 zustand persist 的旧列表而看不出问题 ——
 * 只有全新 profile 才暴露，所以这类 bug 极难在日常使用中发现，值得结构性钉死。
 *
 * ⚠️ 守的是「身份变更 ⇒ 整页重载」这条规则本身，而不是某一个组件的症状：
 * 以后任何新组件只要在 mount 时拉一次「属于我的」数据，就会重新踩一遍。
 */

const FILES = [
  "src/components/auth/auth-form.tsx",
  "src/components/settings/auth-section.tsx",
];

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

/** 去掉注释 —— 注释里会引用 `router.refresh()` 来解释为什么不能用它 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("身份变更后必须整页重载", () => {
  for (const rel of FILES) {
    it(`${rel} 用 window.location 跳转，而不是 next/navigation 的客户端跳转`, () => {
      const code = stripComments(read(rel));
      expect(code).toMatch(/window\.location\.(assign|replace|href)/);
      expect(code).not.toMatch(/router\.(push|replace|refresh)\s*\(/);
      expect(code).not.toMatch(/\buseRouter\b/);
    });
  }
});
