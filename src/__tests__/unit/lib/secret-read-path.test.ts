/**
 * 结构性守卫：数据库里的密钥读取必须收敛到单一的、必然解密的入口。
 *
 * 真实事故（2026-09）：密钥落库加密上线时，`provider-secrets.ts` 里有两处各自
 * `db.select` 读密钥列，只给 `getProviderSecret` 接了 `decryptSecret`，
 * 漏了 `resolveOne` —— 而那是所有图片/视频/文本生成的密钥注入热路径。
 * 结果密文被当成 API Key 发给上游，报 401 "The API key format is incorrect"，
 * 且**全部生成功能同时失效**。
 *
 * 收敛成单一读取点（`readDecryptedSecret`）后，本测试锁死这个不变量。
 */

import { describe, it, expect, vi } from "vitest";

// 全局 setup.ts mock 了 node:fs；本测试要读真实源码文件
vi.mock("node:fs", async (importOriginal) => importOriginal());

import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8");

describe("密钥读取路径收敛", () => {
  it("provider-secrets.ts 只有一处 select 密钥列", () => {
    const src = read("src/lib/provider-secrets.ts");
    const hits = (src.match(/providerSecrets\.apiKey/g) ?? []).length;
    expect(
      hits,
      "provider-secrets.ts 出现了多处直接 select apiKey 列。" +
        "所有读取都必须走 readDecryptedSecret()，否则极易漏接解密（见文件头注释里的事故）。"
    ).toBe(1);
  });

  it("那唯一的读取点确实解密", () => {
    const src = read("src/lib/provider-secrets.ts");
    expect(src).toContain("decryptSecret(row.apiKey)");
    expect(src).toContain("decryptSecret(row.secretKey)");
  });

  it("ark 凭证读取同样解密", () => {
    const src = read("src/lib/ark-asset-library-credentials.ts");
    expect(src).toContain("decryptSecret(row.accessKeyId)");
    expect(src).toContain("decryptSecret(row.secretAccessKey)");
  });

  it("两个模块的写入侧都加密", () => {
    for (const f of [
      "src/lib/provider-secrets.ts",
      "src/lib/ark-asset-library-credentials.ts",
    ]) {
      expect(read(f), `${f} 没有调用 encryptSecret`).toContain("encryptSecret(");
    }
  });
});
