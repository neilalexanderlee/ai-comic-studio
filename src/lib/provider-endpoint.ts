/**
 * 上游端点的可信来源与可用性判定。
 *
 * ## 为什么需要它
 *
 * 生成请求里的 `modelConfig` **整个来自客户端**（providerId / protocol / baseUrl / modelId），
 * 服务端只把 `apiKey` 换成自己库里存的那一份 —— 也就是说
 * **「密钥从服务端取，地址听客户端的」**。
 *
 * 在自带 Key（BYOK）模式下这没问题：你的 Key 发到你自己指定的地址。
 * 但它有两个后果：
 *
 * 1. **平台统一 Key 模式下这是直接的密钥外泄**：把 `baseUrl` 换成自己的服务器，
 *    一个请求就能收到平台 Key。「管理员配模型、用户买积分」那套要落地，
 *    这一条必须先改掉 —— 它是前提，不是优化。
 * 2. **今天就存在的 SSRF 面**：服务端会向调用方指定的地址发请求。
 *    多租户下可以拿它去探内网、打云厂商的元数据地址（169.254.169.254）。
 *
 * 所以地址一律从**服务端存的 provider 记录**取（`user_client_prefs`），
 * 请求体里的 `baseUrl` / `protocol` 只作参考、不作数。
 *
 * ## 私网地址为什么默认放行
 *
 * 自部署用户会把 provider 指向本机（Ollama、LM Studio、自建网关），
 * 一刀切禁掉私网等于把这类用法废掉。所以只在 `BILLING_ENABLED=1`
 * （即平台模式、有别的用户在用同一台机器）时才拦。
 * 与约定 8c / 8j / 8k 是同一条原则：**默认值要让单机装机即用**。
 */

export class UntrustedEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UntrustedEndpointError";
  }
}

/** 环回 / 私网 / 链路本地 / 云元数据地址 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  // IPv6 唯一本地地址 fc00::/7 与链路本地 fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 —— 云厂商元数据服务（169.254.169.254）就在这一段
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * 这个地址能不能作为上游端点。不能就抛 `UntrustedEndpointError`。
 *
 * `allowPrivate` 为 true 时只做协议与格式校验（自部署默认）。
 */
export function assertUsableEndpoint(
  baseUrl: string | undefined | null,
  opts: { allowPrivate: boolean },
): void {
  if (!baseUrl?.trim()) {
    throw new UntrustedEndpointError("provider 没有配置服务地址");
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new UntrustedEndpointError(`provider 服务地址不是合法 URL：${baseUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UntrustedEndpointError(`provider 服务地址必须是 http(s)：${baseUrl}`);
  }
  if (!opts.allowPrivate && isPrivateHost(url.hostname)) {
    throw new UntrustedEndpointError(
      `平台模式下不允许把上游地址指向内网或环回地址：${url.hostname}`,
    );
  }
}
