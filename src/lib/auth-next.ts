/**
 * `?next=` 的开放重定向防护，登录页与注册页共用。
 *
 * 不校验就是标准的开放重定向：攻击者发一个
 * `https://我们的域名/zh/login?next=https://evil.com` 的链接，
 * 用户在**我们的站点**上正常登录完被送到钓鱼站，
 * 而整个过程地址栏都显示我们的域名 —— 这正是钓鱼最想要的可信外壳。
 *
 * 放在独立模块而不是页面文件里，是因为现在有两个入口页要用它。
 * 各写一份的话，早晚有一份漏掉某个变体。
 */
export function safeNext(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  // 必须是站内绝对路径
  if (!raw.startsWith("/")) return fallback;
  // `//evil.com` 是协议相对 URL，浏览器当成跨站地址；
  // `/\evil.com` 同理 —— 部分浏览器把反斜杠规范化成斜杠
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}
