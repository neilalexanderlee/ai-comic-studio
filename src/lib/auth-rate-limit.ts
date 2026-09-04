import "server-only";

/**
 * 登录失败限速。
 *
 * ## 为什么需要
 *
 * 端口一旦对公网开放，全网扫描器几天内必然找上门。没有限速的登录接口意味着
 * 攻击者可以用字典无限次尝试 —— scrypt 哈希会让每次尝试变慢（这是好事），
 * 但慢不等于挡得住，只是把「几小时爆破」变成「几天爆破」。
 *
 * ## 为什么是内存而不是数据库
 *
 * web 只有一个进程（worker 不处理 HTTP），内存计数就够，且不会给每次登录
 * 都加一次写库。代价是进程重启后计数清零 —— 攻击者要利用这一点，得先能
 * 让服务重启，那已经是另一个量级的问题了。
 *
 * ## 按 IP 还是按用户名
 *
 * **两个都算，取更严的那个。**
 *   · 只按 IP：攻击者换 IP 就绕过（僵尸网络轻易做到）
 *   · 只按用户名：攻击者用不存在的用户名喷洒，就永远不触发
 * 两个都记，才既挡得住单点爆破，也挡得住撞库喷洒。
 */

/** 计数窗口 */
const WINDOW_MS = 15 * 60 * 1000;
/** 窗口内允许的失败次数 */
const MAX_FAILURES = 8;
/** 记录上限，防止被大量伪造 key 撑爆内存 */
const MAX_ENTRIES = 10_000;

interface Bucket {
  count: number;
  /** 窗口起点 */
  since: number;
}

const buckets = new Map<string, Bucket>();

function prune(now: number): void {
  for (const [k, b] of buckets) {
    if (now - b.since > WINDOW_MS) buckets.delete(k);
  }
  // 清理之后仍然过多，说明正在被灌 key —— 直接整体丢弃，
  // 宁可短暂失去计数，也不能让这里变成内存耗尽的入口
  if (buckets.size > MAX_ENTRIES) buckets.clear();
}

function hit(key: string, now: number): number {
  const b = buckets.get(key);
  if (!b || now - b.since > WINDOW_MS) {
    buckets.set(key, { count: 1, since: now });
    return 1;
  }
  b.count += 1;
  return b.count;
}

function peek(key: string, now: number): number {
  const b = buckets.get(key);
  if (!b || now - b.since > WINDOW_MS) return 0;
  return b.count;
}

/** 从请求里尽力取出客户端 IP。取不到就归到一个共用桶，宁可严一点。 */
export function clientIpOf(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface RateLimitVerdict {
  /** true 表示应当拒绝本次尝试 */
  blocked: boolean;
  /** 建议客户端等待的秒数（用于 Retry-After） */
  retryAfterSeconds: number;
}

/** 在校验密码**之前**调用：这个来源现在还允许尝试吗？ */
export function checkLoginAllowed(ip: string, username: string, now = Date.now()): RateLimitVerdict {
  prune(now);
  const worst = Math.max(peek(`ip:${ip}`, now), peek(`user:${username}`, now));
  if (worst < MAX_FAILURES) return { blocked: false, retryAfterSeconds: 0 };

  const b = buckets.get(`ip:${ip}`) ?? buckets.get(`user:${username}`);
  const elapsed = b ? now - b.since : 0;
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000)),
  };
}

/** 密码错误时调用 */
export function recordLoginFailure(ip: string, username: string, now = Date.now()): void {
  hit(`ip:${ip}`, now);
  hit(`user:${username}`, now);
}

/** 登录成功时调用，清掉该来源的计数 —— 否则正常用户打错几次密码会被自己拖累 */
export function recordLoginSuccess(ip: string, username: string): void {
  buckets.delete(`ip:${ip}`);
  buckets.delete(`user:${username}`);
}

/** 仅供测试 */
export function __resetLoginRateLimit(): void {
  buckets.clear();
}

export const LOGIN_RATE_LIMIT = { WINDOW_MS, MAX_FAILURES } as const;
