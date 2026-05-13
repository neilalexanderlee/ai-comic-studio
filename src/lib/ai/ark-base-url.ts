/**
 * 火山方舟 OpenAPI 根路径须包含 `/api/v3`（与官方「Base URL 及鉴权」一致）。
 * @see https://www.volcengine.com/docs/82379/1298459
 *
 * 若用户只填了 `https://ark.<region>.volces.com`，则补全为 `.../api/v3`，
 * 否则 OpenAI SDK 的 `/images/generations`、本项目的 `/contents/generations/tasks` 会落在错误路径导致 404。
 */
export function ensureArkApiV3BaseUrl(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, "");
  if (!u) return u;
  if (/\/api\/v3$/i.test(u)) return u;
  if (/^https?:\/\/ark\.[^/]+\.volces\.com$/i.test(u)) return `${u}/api/v3`;
  return u;
}
