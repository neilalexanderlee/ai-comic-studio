/**
 * 编辑器素材的跨会话缓存（Cache Storage）。
 *
 * ## 为什么需要
 *
 * 编辑器每次打开都要把整条时间线的素材重新下载一遍才能解码（`MP4Clip.ready` 要等
 * 整个流下载并解析完才 resolve）。产物迁到 OSS 之后，这笔重复下载直接变成钱：
 * 下行流量包只有 2 GB/月，而一集 15 条 480p 代理就是 12.5 MB —— 2026-09-02 已经
 * 因为重复下载打穿流量、账户欠费停服过一次。
 *
 * 缓存住之后，同一集第二次打开是零流量、零等待。
 *
 * ## 缓存键为什么不能用 URL
 *
 * OSS 是私有桶，实际下载地址是**签名 URL**。签名 URL 即使按 30 分钟窗口对齐
 * （见 artifact-store.ts 的 SIGNED_URL_WINDOW_SECONDS），跨窗口仍然会变 ——
 * 拿它当缓存键等于每半小时全部失效。所以这里用稳定的**存储引用**
 * （`oss://frames/x.png` / `uploads/videos/y.mp4`）做键，URL 只用来实际取数据。
 *
 * ## 失败一律降级
 *
 * 无痕窗口、站点数据被清、浏览器限制存储配额 —— Cache Storage 的每个调用都可能抛。
 * 所有分支都 try/catch 并退回普通 fetch：缓存是加速手段，不是正确性依赖。
 */

/**
 * 取产物。**一定要用它，不要裸 fetch。**
 *
 * `/api/uploads/_oss/<key>` 是 302 跳到 OSS 签名 URL，而这一跳带
 * `Cache-Control: private, max-age=1800`。浏览器缓存的是**重定向本身**，于是会出现
 * 「缓存里的 302 还在，它指向的签名却已经过期」—— OSS 对过期签名返回 403，
 * 而 403 没有 CORS 头，浏览器于是把它报成一个毫无线索的 `TypeError: Failed to fetch`。
 *
 * 实测就是这样：同一个 URL 默认 fetch 必失败，加 `cache: "reload"` 立刻 200，
 * 之后默认 fetch 又好了（缓存被刷新）。
 *
 * 另一类失败是页面正忙的瞬间（打开 3D 导演台要同时创建两个 WebGL 上下文）请求直接挂掉。
 * 两类都靠"重试 + 绕过缓存 + 退避"兜住 —— 它们的共同点是**都会报成一个毫无线索的
 * `TypeError: Failed to fetch`**，与其在调用处逐个猜，不如在这里统一重试。
 */
export async function fetchArtifact(url: string, signal?: AbortSignal): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      // 第一次走正常缓存；重试一律绕过缓存，这样才可能拿到新的 302 和新的签名
      const init: RequestInit = attempt === 0 ? {} : { cache: "reload" };
      if (signal) init.signal = signal;
      const res = await fetch(url, init);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      // 4xx 里只有 403（签名过期）值得重试；404/401 重试多少次都一样
      if (res.status !== 403 && res.status < 500) return res;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
    }
    // 退避：失败常发生在页面正忙的瞬间（打开导演台时要同时建两个 WebGL 上下文），
    // 隔一小会儿再来一次基本就成了
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const CACHE_NAME = "editor-media-v1";
/** 缓存总量上限。一集约 12.5MB，200MB 够放十几集。 */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** 单条上限。没有预览代理、回落到源片时可能是几十 MB，那种不进缓存，避免一条挤掉整个池子。 */
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
/** LRU 索引存 localStorage（Cache Storage 自身不记录访问时间与大小） */
const INDEX_KEY = "editor-media-cache-index";

interface IndexEntry {
  /** 缓存键（存储引用） */
  k: string;
  bytes: number;
  /** 最近一次使用的时间戳 */
  at: number;
}

function cacheRequestUrl(ref: string): string {
  // 合成一个不会真的去请求的 https URL —— Cache API 要求键是合法 URL
  return `https://editor-media.local/${encodeURIComponent(ref)}`;
}

function readIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as IndexEntry[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: IndexEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    /* 配额满或被禁用：索引丢了顶多退化成"缓存不淘汰"，不影响取数 */
  }
}

function touch(ref: string): void {
  const index = readIndex();
  const hit = index.find((e) => e.k === ref);
  if (!hit) return;
  hit.at = Date.now();
  writeIndex(index);
}

/** 记账并按 LRU 淘汰到总量上限以内 */
async function record(cache: Cache, ref: string, bytes: number): Promise<void> {
  const index = readIndex().filter((e) => e.k !== ref);
  index.push({ k: ref, bytes, at: Date.now() });

  index.sort((a, b) => a.at - b.at); // 最久未用的排前面
  let total = index.reduce((sum, e) => sum + e.bytes, 0);
  while (total > MAX_TOTAL_BYTES && index.length > 1) {
    const victim = index.shift()!;
    total -= victim.bytes;
    try {
      await cache.delete(cacheRequestUrl(victim.k));
    } catch {
      /* 删不掉就算了，下次还会被选中 */
    }
  }
  writeIndex(index);
}

/**
 * 取素材。命中缓存则零网络，未命中则下载并写入缓存。
 *
 * @param ref 稳定的存储引用（`oss://…` 或 `uploads/…`），用作缓存键
 * @param url 实际可下载地址（OSS 签名 URL 或 /api/uploads/… ），只用来取数
 */
export async function fetchMedia(
  ref: string,
  url: string,
  signal: AbortSignal
): Promise<Response> {
  let cache: Cache | null = null;
  try {
    if (typeof caches !== "undefined") cache = await caches.open(CACHE_NAME);
  } catch {
    cache = null;
  }

  if (cache) {
    try {
      const hit = await cache.match(cacheRequestUrl(ref));
      if (hit) {
        touch(ref);
        return hit;
      }
    } catch {
      /* 读缓存失败 → 当作未命中 */
    }
  }

  const res = await fetchArtifact(url, signal);
  if (!res.ok || !cache) return res;

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ENTRY_BYTES) return res;

  // 整段读进内存再入缓存。看似牺牲了流式，实际不亏：MP4Clip.ready 本来就要等
  // 整个流下载解析完，这里不引入额外等待，还换来精确的大小记账。
  try {
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength <= MAX_ENTRY_BYTES) {
      const headers = new Headers();
      const contentType = res.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);
      await cache.put(cacheRequestUrl(ref), new Response(buffer.slice(0), { headers }));
      await record(cache, ref, buffer.byteLength);
    }
    return new Response(buffer);
  } catch {
    // 写缓存失败（配额/无痕窗口）→ 退回一次普通下载，功能不受影响
    return fetchArtifact(url, signal);
  }
}
