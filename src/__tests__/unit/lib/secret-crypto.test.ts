import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const KEY = "test-vault-key-at-least-8-chars";

async function freshModule() {
  // 模块内部缓存了「已警告过」标志，且 key 是每次调用现读的；
  // 重置模块保证各用例互不影响。
  vi.resetModules();
  return await import("@/lib/secret-crypto");
}

describe("secret-crypto", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("已配置密钥", () => {
    beforeEach(() => {
      vi.stubEnv("AI_COMIC_SECRETS_VAULT_KEY", KEY);
    });

    it("加解密往返一致", async () => {
      const { encryptSecret, decryptSecret } = await freshModule();
      const plain = "sk-abcdef1234567890";
      const enc = encryptSecret(plain)!;
      expect(enc).not.toBe(plain);
      expect(enc.startsWith("enc:v1:")).toBe(true);
      expect(decryptSecret(enc)).toBe(plain);
    });

    it("同一明文两次加密结果不同（IV 不复用）", async () => {
      const { encryptSecret } = await freshModule();
      expect(encryptSecret("same-value")).not.toBe(encryptSecret("same-value"));
    });

    it("存量明文原样读出（无需数据迁移）", async () => {
      const { decryptSecret } = await freshModule();
      expect(decryptSecret("legacy-plaintext-key")).toBe("legacy-plaintext-key");
    });

    it("空值不加密", async () => {
      const { encryptSecret, decryptSecret } = await freshModule();
      expect(encryptSecret("")).toBe("");
      expect(encryptSecret(null)).toBe(null);
      expect(decryptSecret(null)).toBe(null);
    });

    it("密文被篡改时返回空串而不是抛异常", async () => {
      const { encryptSecret, decryptSecret } = await freshModule();
      const enc = encryptSecret("secret")!;
      const tampered = enc.slice(0, -4) + "AAAA";
      expect(decryptSecret(tampered)).toBe("");
    });

    it("isSecretEncryptionEnabled 为 true", async () => {
      const { isSecretEncryptionEnabled } = await freshModule();
      expect(isSecretEncryptionEnabled()).toBe(true);
    });
  });

  describe("未配置密钥（本地开发降级）", () => {
    beforeEach(() => {
      vi.stubEnv("AI_COMIC_SECRETS_VAULT_KEY", "");
    });

    it("加密降级为明文，读写仍然可用", async () => {
      const { encryptSecret, decryptSecret } = await freshModule();
      expect(encryptSecret("plain-key")).toBe("plain-key");
      expect(decryptSecret("plain-key")).toBe("plain-key");
    });

    it("isSecretEncryptionEnabled 为 false", async () => {
      const { isSecretEncryptionEnabled } = await freshModule();
      expect(isSecretEncryptionEnabled()).toBe(false);
    });

    it("密钥太短同样视为未配置", async () => {
      vi.stubEnv("AI_COMIC_SECRETS_VAULT_KEY", "short");
      const { isSecretEncryptionEnabled } = await freshModule();
      expect(isSecretEncryptionEnabled()).toBe(false);
    });
  });

  it("换了密钥后读旧密文返回空串，不会炸掉调用链路", async () => {
    vi.stubEnv("AI_COMIC_SECRETS_VAULT_KEY", KEY);
    const m1 = await freshModule();
    const enc = m1.encryptSecret("secret-under-old-key")!;

    vi.stubEnv("AI_COMIC_SECRETS_VAULT_KEY", "a-totally-different-key-value");
    const m2 = await freshModule();
    expect(m2.decryptSecret(enc)).toBe("");
  });
});
