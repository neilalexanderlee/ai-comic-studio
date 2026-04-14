export function getUserIdFromRequest(request: Request): string {
  return request.headers.get("x-user-id") ?? "";
}
