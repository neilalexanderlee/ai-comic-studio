/**
 * proxy-setup.ts
 *
 * Configures Node.js's native fetch (undici) to route all outbound HTTP/HTTPS
 * requests through a local proxy — typically a VPN client like Clash Verge.
 *
 * Usage:
 *   Add to .env.local:  HTTPS_PROXY=http://127.0.0.1:7897
 *   (Replace port with whatever your VPN client exposes.)
 *
 * This must be called BEFORE any AI SDK is initialised (i.e. at the top of
 * bootstrap()) so that @google/genai and all other fetch-based clients
 * automatically inherit the proxy dispatcher.
 *
 * Requires: pnpm add undici
 */

export async function setupProxy(): Promise<void> {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (!proxyUrl) return;

  try {
    // undici must be installed: pnpm add undici
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const undici = (await import("undici" as any)) as any;
    undici.setGlobalDispatcher(new undici.ProxyAgent(proxyUrl));
    console.log(`[Proxy] Global fetch dispatcher set → ${proxyUrl}`);
  } catch (err) {
    // undici not installed — print a clear warning instead of silently failing
    console.warn(
      `[Proxy] HTTPS_PROXY is set to "${proxyUrl}" but the "undici" package ` +
      `is not installed. Run: pnpm add undici\n`,
      err
    );
  }
}
