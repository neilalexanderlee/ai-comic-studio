import { LogoIcon } from "@/components/logo";

/**
 * 登录 / 注册两页共用的外壳（居中卡片 + 标题 + 页脚）。
 *
 * 抽出来只为一件事：**两页看起来必须是同一个网站**。
 * 各写一份的话，改了这边忘了那边，用户在两页之间跳转会看到布局跳变。
 */
export function AuthShell({
  subtitle,
  children,
  footer,
}: {
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[--surface] p-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LogoIcon size={22} />
          </div>
          <h1 className="font-display text-lg font-bold tracking-tight text-[--text-primary]">
            AI 漫剧工坊
          </h1>
          <p className="text-xs text-[--text-muted]">{subtitle}</p>
        </div>

        <div className="rounded-2xl border border-[--border-subtle] bg-white p-6 shadow-sm">
          {children}
        </div>

        {footer && <div className="space-y-2 text-center text-[11px] text-[--text-muted]">{footer}</div>}
      </div>
    </div>
  );
}
