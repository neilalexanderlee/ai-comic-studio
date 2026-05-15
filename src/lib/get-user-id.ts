import { getAuthUserIdFromRequest } from "./auth";

/**
 * 从请求中读取当前用户 ID。
 * 优先级：签名 httpOnly cookie（新账号系统）> x-user-id header（旧匿名模式兼容）
 */
export function getUserIdFromRequest(request: Request): string {
  return getAuthUserIdFromRequest(request) ?? request.headers.get("x-user-id") ?? "";
}
