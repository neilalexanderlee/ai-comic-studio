/**
 * 编辑器路由的 layout 覆盖。
 * 使用 fixed inset-0 逃脱父级 episode layout 的 padding 和 overflow-y-auto，
 * 让编辑器以全屏模式渲染（编辑器有自己的顶栏和后退按钮）。
 */
export default function EditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-white">
      {children}
    </div>
  );
}
