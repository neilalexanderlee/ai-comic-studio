/**
 * 平台 Key 解析 —— 本次改动里**最容易出错、后果最严重**的一处。
 *
 * ## 要锁的那条不变量
 *
 * **密钥和端点必须来自同一个归属人。**
 *
 * `providerId` 是客户端生成的 ULID，存在用户自己的 model-store 里；平台模式下
 * 客户端还会拿到管理员那份 provider 列表，也就知道了管理员的 providerId。
 * 所以只要实现写成「地址取用户的 prefs、密钥取管理员的」，用户建一条同 id、
 * baseUrl 指向自己服务器的记录，一个请求就能收到平台 Key ——
 * 正是约定 8n 想堵的洞换个姿势复活。
 *
 * 其余不变量：
 *  · 用户自己的 Key 优先（BYOK 不被平台 Key 顶掉）
 *  · 谁都没配 → 不注入密钥，而不是退回去用请求体里的地址
 *  · keySource 如实反映这次烧的是谁的钱（限额与将来的计费都靠它）
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
      api_key TEXT NOT NULL, secret_key TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE user_client_prefs (
      user_id TEXT PRIMARY KEY NOT NULL, model_store_json TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL
    );
  `);
  holder.sqlite = sqlite;
  return { db: drizzle(sqlite) };
});

vi.mock("@/lib/db-file-backup", () => ({ scheduleDatabaseHotBackup: () => {} }));
vi.mock("@/lib/secrets-vault-file", () => ({ syncSecretsVaultEncAfterMutation: async () => {} }));

const ADMIN = "u_admin";
const USER = "u_user";
const PROVIDER = "p_shared";
const PLATFORM_URL = "https://ark.cn-beijing.volces.com";
const OWN_URL = "https://my-own-gateway.example.com";
const EVIL_URL = "https://attacker.example.com";
const PLATFORM_KEY = "sk-PLATFORM-secret";
const OWN_KEY = "sk-my-own";

function seedUser(id: string, username: string, role: "owner" | "admin" | "user", status = "active") {
  holder.sqlite!
    .prepare(
      `INSERT INTO users (id, username, password_hash, token_version, role, status, created_at)
       VALUES (?, ?, 'x', 0, ?, ?, 0)`
    )
    .run(id, username, role, status);
}

function seedSecret(userId: string, providerId: string, apiKey: string) {
  holder.sqlite!
    .prepare(
      `INSERT INTO provider_secrets (id, user_id, provider_id, api_key, secret_key, updated_at)
       VALUES (?, ?, ?, ?, NULL, 0)`
    )
    .run(`${userId}:${providerId}`, userId, providerId, apiKey);
}

function seedPrefs(userId: string, providerId: string, baseUrl: string) {
  holder.sqlite!
    .prepare(`INSERT INTO user_client_prefs (user_id, model_store_json, updated_at) VALUES (?, ?, 0)`)
    .run(userId, JSON.stringify({ providers: [{ id: providerId, protocol: "doubao", baseUrl }] }));
}

async function resolve(userId: string) {
  const { resolveModelConfigWithSource } = await import("@/lib/provider-secrets");
  return resolveModelConfigWithSource(userId, {
    video: { providerId: PROVIDER, protocol: "doubao", baseUrl: EVIL_URL, apiKey: "", modelId: "m" },
  });
}

beforeEach(async () => {
  await import("@/lib/db");
  const { __resetAdminCachesForTests } = await import("@/lib/admin");
  __resetAdminCachesForTests();
  const s = holder.sqlite!;
  s.prepare(`DELETE FROM provider_secrets`).run();
  s.prepare(`DELETE FROM user_client_prefs`).run();
  s.prepare(`DELETE FROM users`).run();
  vi.unstubAllEnvs();
});

describe("平台 Key 兜底", () => {
  it("用户没配 Key → 用管理员那把，且地址也来自管理员", async () => {
    seedUser(ADMIN, "admin", "owner");
    seedUser(USER, "someone", "user");
    seedSecret(ADMIN, PROVIDER, PLATFORM_KEY);
    seedPrefs(ADMIN, PROVIDER, PLATFORM_URL);

    const r = await resolve(USER);
    expect(r.config?.video?.apiKey).toBe(PLATFORM_KEY);
    expect(r.config?.video?.baseUrl).toBe(PLATFORM_URL);
    expect(r.sources.video).toBe("platform");
  });

  it("⚠️ 攻击面：用户用同一个 providerId 指向自己的服务器，也绝不能拿到平台 Key", async () => {
    seedUser(ADMIN, "admin", "owner");
    seedUser(USER, "someone", "user");
    seedSecret(ADMIN, PROVIDER, PLATFORM_KEY);
    seedPrefs(ADMIN, PROVIDER, PLATFORM_URL);
    // 用户自己也建了一条同 id 的 provider，baseUrl 指向攻击者服务器（但没有自己的 Key）
    seedPrefs(USER, PROVIDER, EVIL_URL);

    const r = await resolve(USER);
    // 密钥若要发出去，只能发到管理员登记的那个地址
    expect(r.config?.video?.baseUrl).not.toBe(EVIL_URL);
    expect(r.config?.video?.baseUrl).toBe(PLATFORM_URL);
  });

  it("没有任何管理员 → 不注入密钥（而不是退回请求体里的地址）", async () => {
    seedUser(USER, "someone", "user");
    const r = await resolve(USER);
    expect(r.config?.video?.apiKey).toBe("");
    expect(r.sources.video).toBe("user");
  });

  it("owner 被停用 → 不再作为平台 Key 归属人", async () => {
    seedUser(ADMIN, "admin", "owner", "disabled");
    seedUser(USER, "someone", "user");
    seedSecret(ADMIN, PROVIDER, PLATFORM_KEY);
    seedPrefs(ADMIN, PROVIDER, PLATFORM_URL);

    const r = await resolve(USER);
    expect(r.config?.video?.apiKey).toBe("");
  });
});

describe("BYOK 优先", () => {
  it("用户自己配了 Key → 用自己的，keySource=user", async () => {
    seedUser(ADMIN, "admin", "owner");
    seedUser(USER, "someone", "user");
    seedSecret(ADMIN, PROVIDER, PLATFORM_KEY);
    seedPrefs(ADMIN, PROVIDER, PLATFORM_URL);
    seedSecret(USER, PROVIDER, OWN_KEY);
    seedPrefs(USER, PROVIDER, OWN_URL);

    const r = await resolve(USER);
    expect(r.config?.video?.apiKey).toBe(OWN_KEY);
    expect(r.config?.video?.baseUrl).toBe(OWN_URL);
    expect(r.sources.video).toBe("user");
  });

  it("ALLOW_USER_PROVIDERS=0 时非管理员跳过自己的 Key，统一走平台", async () => {
    vi.stubEnv("ALLOW_USER_PROVIDERS", "0");
    seedUser(ADMIN, "admin", "owner");
    seedUser(USER, "someone", "user");
    seedSecret(ADMIN, PROVIDER, PLATFORM_KEY);
    seedPrefs(ADMIN, PROVIDER, PLATFORM_URL);
    seedSecret(USER, PROVIDER, OWN_KEY);
    seedPrefs(USER, PROVIDER, OWN_URL);

    const r = await resolve(USER);
    expect(r.config?.video?.apiKey).toBe(PLATFORM_KEY);
    expect(r.config?.video?.baseUrl).toBe(PLATFORM_URL);
    expect(r.sources.video).toBe("platform");
  });

  it("ALLOW_USER_PROVIDERS=0 下 owner 仍用自己的（他就是平台配置的作者）", async () => {
    vi.stubEnv("ALLOW_USER_PROVIDERS", "0");
    seedUser(ADMIN, "admin", "owner");
    seedSecret(ADMIN, PROVIDER, PLATFORM_KEY);
    seedPrefs(ADMIN, PROVIDER, PLATFORM_URL);

    const r = await resolve(ADMIN);
    expect(r.config?.video?.apiKey).toBe(PLATFORM_KEY);
    expect(r.sources.video).toBe("user");
  });
});

describe("运营 admin 在密钥这件事上和普通用户没有区别", () => {
  it("⚠️ 平台模式下运营 admin 也走平台 Key，不能用自己配的那份", async () => {
    vi.stubEnv("ALLOW_USER_PROVIDERS", "0");
    seedUser(ADMIN, "neil", "owner");
    seedUser("u_ops", "ops", "admin");
    seedSecret(ADMIN, PROVIDER, PLATFORM_KEY);
    seedPrefs(ADMIN, PROVIDER, PLATFORM_URL);
    // 运营 admin 手上即便有历史残留的密钥与地址，也一律不采用
    seedSecret("u_ops", PROVIDER, OWN_KEY);
    seedPrefs("u_ops", PROVIDER, EVIL_URL);

    const r = await resolve("u_ops");
    expect(r.config?.video?.apiKey).toBe(PLATFORM_KEY);
    expect(r.config?.video?.baseUrl).toBe(PLATFORM_URL);
    expect(r.sources.video).toBe("platform");
  });
});
