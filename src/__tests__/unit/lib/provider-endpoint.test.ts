/**
 * 上游端点的可信来源。
 *
 * 背景：生成请求里的 `modelConfig` 整个来自客户端，服务端只把 `apiKey` 换成库里那份 ——
 * 即「密钥从服务端取，地址听客户端的」。BYOK 下无害（你的 Key 发到你指定的地址），
 * 但它是「管理员配模型、用户买积分」那套落地的前提：平台统一 Key 之下，
 * 把 baseUrl 换成自己的服务器，一个请求就能收走平台 Key。
 *
 * 锁住的不变量：
 *  · 私网/环回/云元数据地址在平台模式下被拒
 *  · 自部署默认放行私网 —— 指向本机 Ollama 这类用法不能被废掉
 */
import { describe, it, expect } from "vitest";
import {
  isPrivateHost,
  assertUsableEndpoint,
  UntrustedEndpointError,
} from "@/lib/provider-endpoint";

describe("isPrivateHost", () => {
  it.each([
    "localhost", "127.0.0.1", "0.0.0.0", "::1",
    "10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.1.1",
    "169.254.169.254", // 云厂商元数据服务
    "fd00::1", "fe80::1", "printer.local",
  ])("%s 是私网/本地地址", (h) => expect(isPrivateHost(h)).toBe(true));

  it.each([
    "ark.cn-beijing.volces.com", "api.openai.com", "8.8.8.8",
    "172.32.0.1", // 刚好落在 172.16/12 之外
    "192.169.1.1",
  ])("%s 是公网地址", (h) => expect(isPrivateHost(h)).toBe(false));
});

describe("assertUsableEndpoint", () => {
  const platform = { allowPrivate: false };
  const selfHost = { allowPrivate: true };

  it("正常的公网 https 地址放行", () => {
    expect(() => assertUsableEndpoint("https://ark.cn-beijing.volces.com", platform)).not.toThrow();
  });

  it("空地址被拒 —— 没有地址就不该注入密钥", () => {
    expect(() => assertUsableEndpoint("", platform)).toThrow(UntrustedEndpointError);
    expect(() => assertUsableEndpoint(undefined, platform)).toThrow(UntrustedEndpointError);
  });

  it("非 http(s) 协议被拒", () => {
    expect(() => assertUsableEndpoint("file:///etc/passwd", selfHost)).toThrow(UntrustedEndpointError);
    expect(() => assertUsableEndpoint("gopher://x/", selfHost)).toThrow(UntrustedEndpointError);
  });

  it("不是合法 URL 被拒", () => {
    expect(() => assertUsableEndpoint("不是地址", selfHost)).toThrow(UntrustedEndpointError);
  });

  it("平台模式拒绝内网与元数据地址", () => {
    for (const u of [
      "http://127.0.0.1:11434",
      "http://169.254.169.254/latest/meta-data/",
      "https://192.168.1.10/v1",
    ]) {
      expect(() => assertUsableEndpoint(u, platform), u).toThrow(UntrustedEndpointError);
    }
  });

  it("自部署默认放行内网 —— 本机 Ollama 这类用法不能被废掉", () => {
    expect(() => assertUsableEndpoint("http://localhost:11434/v1", selfHost)).not.toThrow();
  });
});
