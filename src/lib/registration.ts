/**
 * 注册准入模式。
 *
 * ## 三态，而不是布尔
 *
 * ```
 * REGISTRATION_MODE = open | invite | closed
 * ```
 *
 * **未设置时完全走今天的逻辑**：`ALLOW_REGISTRATION !== "0"` → open，`=0` → closed。
 * 一行行为都不变，自部署照常装机即用（与 BILLING_ENABLED / WORKER_IN_WEB /
 * REQUIRE_AUTH 同一条原则）。
 *
 * ## 为什么冲突时 fail closed
 *
 * `ALLOW_REGISTRATION=0` 是别人当**安全措施**设下的。如果一个后加的开关能把它
 * 静默地重新打开，那就是这个项目已知陷阱表里反复出现的那类故障
 * （「部署成功了，跑的却是旧代码」「安全组放行了，容器只绑回环」——
 * 都是两道闸里只开了一道、却以为全开了）。
 * 所以两者冲突时取更严的那个，并在启动时打一条明确的告警说清楚怎么改。
 *
 * ## 为什么是邀请码
 *
 * 见 `db/schema.ts` 的 `inviteCodes` 注释：管理员直接建号要把明文密码经 IM 传给
 * 对方（在一个正要收缩密钥暴露面的改造里新开一个泄露面）；用户名白名单的秘密
 * 只是用户名本身、可被抢注。邀请码这张表以后还能直接当兑换码用。
 */
export type RegistrationMode = "open" | "invite" | "closed";

function rawMode(): RegistrationMode | null {
  const v = process.env.REGISTRATION_MODE?.trim().toLowerCase();
  return v === "open" || v === "invite" || v === "closed" ? v : null;
}

/** 旧开关：只认字面量 "0" 为关闭，与改造前一致 */
function legacyClosed(): boolean {
  return process.env.ALLOW_REGISTRATION === "0";
}

export function resolveRegistrationMode(): RegistrationMode {
  const explicit = rawMode();
  if (!explicit) return legacyClosed() ? "closed" : "open";
  // fail closed：旧开关说关，就是关
  if (legacyClosed()) return "closed";
  return explicit;
}

/** 两个开关互相打架时给出的说明（启动告警 + 注册接口的错误文案都用它） */
export function registrationConflictHint(): string | null {
  const explicit = rawMode();
  if (!explicit || explicit === "closed" || !legacyClosed()) return null;
  return (
    `REGISTRATION_MODE=${explicit} 与 ALLOW_REGISTRATION=0 冲突，已按更严的「关闭注册」处理。` +
    `要启用${explicit === "invite" ? "邀请码" : "自助"}注册，请把 ALLOW_REGISTRATION 删掉或设为 1。`
  );
}

/** 提示：`REGISTRATION_MODE` 写了个认不出来的值 */
export function registrationModeIsUnrecognized(): boolean {
  const v = process.env.REGISTRATION_MODE?.trim();
  return !!v && rawMode() === null;
}
