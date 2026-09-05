/**
 * `hydrateModelConfigSecrets` 是**注入密钥的唯一入口**（文件头有说明），
 * 所以「地址必须来自服务端」这条也只能锁在这里。
 *
 * 锁住的不变量：
 *  · 请求体里的 baseUrl / protocol **不作数**，一律以服务端存的 provider 记录为准
 *  · 服务端没有该 provider 的记录 → **不注入密钥**，而不是退回去用请求体里的地址
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const holder: { sqlite?: import("better-sqlite3").Database } = {};

vi.mock("@/lib/db", async () => {
  const Database = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE provider_secrets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL,
      api_key TEXT NOT NULL, secret_key TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE user_client_prefs (
      user_id TEXT PRIMARY KEY NOT NULL, model_store_json TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  holder.sqlite = sqlite;
  return { db: drizzle(sqlite) };
});

// 热备份与密钥保险箱同步是磁盘副作用，与本测试无关
vi.mock("@/lib/db-file-backup", () => ({ scheduleDatabaseHotBackup: () => {} }));
vi.mock("@/lib/secrets-vault-file", () => ({ syncSecretsVaultEncAfterMutation: async () => {} }));

const USER = "u1";
const PROVIDER = "p1";
const REAL = "https://ark.cn-beijing.volces.com";
const EVIL = "https://attacker.example.com";

function seed(providers: unknown[]) {
  const s = holder.sqlite!;
  s.prepare(`DELETE FROM provider_secrets`).run();
  s.prepare(`DELETE FROM user_client_prefs`).run();
  s.prepare(
    `INSERT INTO provider_secrets (id, user_id, provider_id, api_key, secret_key, created_at, updated_at)
     VALUES ('s1', ?, ?, 'sk-real-platform-key', NULL, 0, 0)`,
  ).run(USER, PROVIDER);
  s.prepare(
    `INSERT INTO user_client_prefs (user_id, model_store_json, updated_at) VALUES (?, ?, 0)`,
  ).run(USER, JSON.stringify({ providers }));
}

async function hydrate(baseUrl: string, protocol = "openai") {
  const { hydrateModelConfigSecrets } = await import("@/lib/provider-secrets");
  return hydrateModelConfigSecrets(USER, {
    image: { providerId: PROVIDER, protocol, baseUrl, apiKey: "", modelId: "m" },
  });
}

// mock 工厂只在 @/lib/db 首次被 import 时执行 —— 不先触发它，holder.sqlite 还是 undefined
beforeEach(async () => {
  vi.unstubAllEnvs();
  await import("@/lib/db");
});

describe("地址只能来自服务端记录", () => {
  it("请求体里的 baseUrl 被服务端记录覆盖，密钥不会发去攻击者的地址", async () => {
    seed([{ id: PROVIDER, protocol: "doubao", baseUrl: REAL }]);
    const out = await hydrate(EVIL);
    expect(out?.image?.baseUrl).toBe(REAL);
    expect(out?.image?.apiKey).toBe("sk-real-platform-key");
  });

  it("protocol 同样以服务端记录为准", async () => {
    seed([{ id: PROVIDER, protocol: "doubao", baseUrl: REAL }]);
    const out = await hydrate(REAL, "openai");
    expect(out?.image?.protocol).toBe("doubao");
  });

  it("服务端没有该 provider 记录 → 不注入密钥（而不是退回用请求体地址）", async () => {
    seed([{ id: "另一个", protocol: "doubao", baseUrl: REAL }]);
    const out = await hydrate(EVIL);
    expect(out?.image?.apiKey).toBe("");
  });

  it("记录里没有 baseUrl 也不注入密钥", async () => {
    seed([{ id: PROVIDER, protocol: "doubao", baseUrl: "" }]);
    expect((await hydrate(EVIL))?.image?.apiKey).toBe("");
  });

  it("平台模式下，记录里的内网地址会被拒（SSRF 面）", async () => {
    seed([{ id: PROVIDER, protocol: "doubao", baseUrl: "http://169.254.169.254/" }]);
    vi.stubEnv("BILLING_ENABLED", "1");
    await expect(hydrate(EVIL)).rejects.toThrow(/内网|环回/);
  });

  it("自部署默认放行内网地址 —— 本机 provider 不能被废掉", async () => {
    seed([{ id: PROVIDER, protocol: "openai", baseUrl: "http://localhost:11434/v1" }]);
    const out = await hydrate(EVIL);
    expect(out?.image?.baseUrl).toBe("http://localhost:11434/v1");
    expect(out?.image?.apiKey).toBe("sk-real-platform-key");
  });
});
