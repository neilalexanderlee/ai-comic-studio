import type { ModelStorePersistPayload } from "@/stores/model-store";

/**
 * `GET /api/user-prefs/model-store` 的响应形状。
 *
 * **单独放在一个纯类型文件里**，而不是从路由文件 export 再让客户端组件 import ——
 * 路由那条链上挂着 `@/lib/db`（进而是 better-sqlite3、`server-only`）。
 * `import type` 理论上会被完全擦除，但这条边界一旦哪天被人改成值导入，
 * 失败方式是构建期的模块解析错误或运行时的 `server-only` 抛错，
 * 而报错位置完全不指向这里（已知陷阱表里「服务端组件调用客户端模块导出的函数」
 * 就是同一类边界问题）。零运行时的类型文件从结构上避免这件事。
 *
 * 为什么是信封而不是裸 payload，见路由文件顶部的注释。
 */
export interface ModelStoreEnvelope {
  /** 未登录（且未开匿名回退）时为 null */
  userId: string | null;
  /** 还没有存过时为 null；毫秒时间戳，**服务端时钟** */
  updatedAt: number | null;
  payload: ModelStorePersistPayload | null;
}
