import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // better-sqlite3 只跑在 Node.js；@webav 包使用浏览器 API，不能在 SSR 环境执行
  // ali-oss 依赖的 urllib 会在运行时 `require('proxy-agent')`（可选依赖），
  // 打包器静态解析不到会直接构建失败 —— 必须外置，交给 Node 在运行时按需加载。
  serverExternalPackages: [
    "better-sqlite3",
    "@webav/av-canvas",
    "@webav/av-cliper",
    "ali-oss",
  ],
  // 显式指定 workspace root，防止 turbopack 误用 /Users/chenjiewen/package-lock.json
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default withNextIntl(nextConfig);
