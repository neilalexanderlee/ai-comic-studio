/**
 * 用户列表里那枚角色徽章。
 *
 * 抽成纯函数有两个原因：管理后台要登录才进得去、改完没法看，
 * 抽出来才能用单测锁住；以及这里的三态判断本身容易写错。
 *
 * ⚠️ **「是 owner」和「平台 Key 挂在他名下」是两件事**，不能合并判断：
 * `role` 列没有唯一约束，可以有多个 owner，而 `getPlatformKeyOwnerId()`
 * 只取**创建时间最早的那个非停用 owner**（或 `PLATFORM_KEY_USERNAME` 指定的那个）。
 * 两个 owner 时两人都「可配置密钥」，但只有一个是**当前实际生效**的 Key 来源 ——
 * 而这恰恰是「我该把 Key 配在哪个账号上」的答案，role 推不出来。
 */
export type RoleBadge = { text: string; className: string } | null;

const VIOLET = "bg-violet-100 text-violet-700";
const AMBER = "bg-amber-100 text-amber-700";

export function roleBadge(role: string, isPlatformKeyOwner: boolean): RoleBadge {
  if (role === "owner") {
    return {
      // 生效中的那个说「来源」，其余 owner 只说「可配置」—— 差别就在这一句
      text: isPlatformKeyOwner ? "owner · 平台 Key 来源" : "owner · 可配置密钥",
      className: VIOLET,
    };
  }
  if (role === "admin") return { text: "运营管理员", className: AMBER };
  return null; // 普通用户不挂徽章
}
