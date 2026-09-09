/**
 * 命令行建号 —— `pnpm user:create <用户名> <密码> [角色]`
 *
 * 为什么需要它：注册可能是关闭的或邀请制的，而管理员偶尔需要直接开一个号
 * （例如要在不发邀请码的情况下建一个运营账号）。没有这个口子时，
 * 唯一办法是临时把注册模式改开、注册完再改回去 —— 中间那段时间门是敞着的。
 *
 * 角色：owner（可配置模型密钥）/ admin（运营）/ user（默认）。
 * 已存在的用户名会被拒绝；要改已有账号的角色请用管理后台。
 *
 * 密码走与注册接口完全相同的 scrypt 哈希，不会在库里留明文。
 */
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { runMigrations } from "@/lib/db";

const ROLES = new Set(["owner", "admin", "user"]);

async function main() {
  const [username, password, role = "user"] = process.argv.slice(2);

  if (!username || !password) {
    console.error("用法：pnpm user:create <用户名> <密码> [owner|admin|user]");
    process.exit(1);
  }
  if (username.trim().length < 2) {
    console.error("用户名至少 2 个字符");
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("密码至少 6 个字符");
    process.exit(1);
  }
  if (!ROLES.has(role)) {
    console.error(`角色只能是 ${[...ROLES].join(" / ")}`);
    process.exit(1);
  }

  runMigrations();

  const name = username.trim();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, name))
    .limit(1);
  if (existing) {
    console.error(`用户名「${name}」已存在。改角色请用管理后台。`);
    process.exit(1);
  }

  const id = ulid();
  await db.insert(users).values({
    id,
    username: name,
    passwordHash: await hashPassword(password),
    role,
    createdAt: new Date(),
  });

  console.log(`已创建：${name}（角色 ${role}）`);
  if (role !== "user") {
    console.log("提醒：请让本人登录后立即在「设置 → 账号 → 修改密码」改掉初始密码。");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
