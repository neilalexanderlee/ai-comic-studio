/**
 * 服务端组件不能调用 `"use client"` 模块里导出的**函数**。
 *
 * 这条为什么值得单独写测试：**它既不是类型错误也不是构建错误**。
 * `npx tsc --noEmit` 干净、`next build` 成功、单测全绿，
 * 只有真正渲染到那条分支时才在运行时抛：
 *
 *   Error: Attempted to call buttonVariants() from the server but buttonVariants
 *   is on the client. It's not possible to invoke a client function from the server.
 *
 * 结果是线上 500。2026-09-05 实测踩过：首页加了「未登录时把 Link 渲染成按钮」的分支，
 * 本地因为没开 `REQUIRE_AUTH` 所以那条分支根本没渲染过，一路绿灯上了生产才炸。
 *
 * 所以这里做结构性检查：`buttonVariants` 必须待在没有 `"use client"` 的模块里，
 * 且服务端文件只能从那个模块 import 它。
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 全局 setup 把 node:fs mock 掉了（所有 existsSync/readFileSync 恒为 false/""），
// 这个测试需要真实读盘 —— 与 art-style-consistency.test.ts 同一模式
vi.mock("node:fs", async (importOriginal) => importOriginal());

const SRC = path.resolve(__dirname, "../../../");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const isClientModule = (src: string) => /^\s*["']use client["']/m.test(src.slice(0, 200));

describe("buttonVariants 必须服务端可用", () => {
  it("button-variants 模块本身不带 'use client'", () => {
    const p = path.join(SRC, "components/ui/button-variants.ts");
    expect(fs.existsSync(p)).toBe(true);
    expect(isClientModule(fs.readFileSync(p, "utf8"))).toBe(false);
  });

  it("服务端文件不得从 'use client' 的 button 模块取 buttonVariants", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = fs.readFileSync(file, "utf8");
      if (isClientModule(src)) continue; // 客户端文件怎么 import 都行
      // 只匹配从 ui/button（而不是 ui/button-variants）导入 buttonVariants 的写法
      const re = /import\s*\{[^}]*\bbuttonVariants\b[^}]*\}\s*from\s*["'][^"']*\/ui\/button["']/;
      if (re.test(src)) offenders.push(path.relative(SRC, file));
    }
    expect(
      offenders,
      `这些服务端文件从 "use client" 的 ui/button 导入了 buttonVariants，` +
        `运行时会 500。改成从 "@/components/ui/button-variants" 导入：\n` +
        offenders.join("\n")
    ).toEqual([]);
  });
});
