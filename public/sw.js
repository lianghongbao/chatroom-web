/**
 * 聊天图片的本地缓存。
 *
 * 图片存在 OSS/CDN 上，地址每次上传都是新的（object key 里带唯一 id），
 * 同一个地址永远指向同一份内容 —— 缓存多久都不会拿到旧图。
 *
 * 只拦**跨域**的图片请求（OSS / CDN）：
 *   - 应用自己的图片资源（图标之类）不缓存 —— 开发期改了资源不会被旧缓存挡住
 *   - 同源资源本来就有 HTTP 缓存，用不着在这里再存一份
 *
 * 跨域图片在 Service Worker 里拿到的是 **opaque 响应**：
 *   - status 是 0、ok 是 false，body 也读不到
 *   - 所以**不能**用 res.ok 判断成败 —— 一律当成功存下来；
 *     真加载失败（比如 404）由页面侧的 img onError 通知这里删掉
 *   - Chromium 给每条 opaque 响应按 ~8MB 记账（防跨域体积泄漏），
 *     所以条数上限不能大 —— 见 MAX_ENTRIES
 */

// 缓存名前缀。页面侧（src/utils/imageCache.ts）按这个前缀找缓存。
const CACHE_PREFIX = 'chatroom-img-'
const CACHE_NAME = `${CACHE_PREFIX}v1`

// 最多缓存多少张图。
//
// 上限按条数算而不是按字节 —— opaque 响应读不到真实大小。
// 60 条 × ~8MB 记账 ≈ 480MB 配额占用，手机上还能接受。
const MAX_ENTRIES = 60

self.addEventListener('install', (event) => {
  // 装完立刻接管 —— 不用等用户下次刷新才开始缓存。
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 旧版本缓存删掉 —— 改了缓存逻辑后老数据格式对不上。
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME)
          .map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  if (request.destination !== 'image') return
  // 只缓存跨域图片（OSS / CDN）。
  if (new URL(request.url).origin === self.location.origin) return
  event.respondWith(serveImage(request))
})

// 页面通知：「这张图加载失败了，从缓存里删掉」。
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'evict') return
  event.waitUntil(evict(data.url))
})

/**
 * 取一张图：本地有就本地给，没有就下载并顺手存下来。
 *
 * cache-first —— 图片地址是不变的，缓存命中就是命中，
 * 没必要每次都回源校验一遍。
 */
async function serveImage(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  // opaque 响应（跨域图片）status 为 0、ok 为 false —— 只能靠 type 区分。
  if (response.type === 'opaque' || response.ok) {
    await store(cache, request, response.clone())
  }
  return response
}

/**
 * 存进缓存。
 *
 * 配额满了（QuotaExceededError）就先腾一批地方再试一次；
 * 还是放不下就算了 —— 图片照常显示，只是这次没进缓存。
 */
async function store(cache, request, response) {
  try {
    await cache.put(request, response)
  } catch {
    await evictOldest(cache, Math.ceil(MAX_ENTRIES / 4))
    try {
      await cache.put(request, response)
    } catch {
      // 存不下了 —— 放弃这一条，不影响显示。
    }
  }
  await trim(cache)
}

/**
 * 删掉最老的一批。
 *
 * Cache API 的 keys() 按写入顺序返回，队首就是最老的 ——
 * 先进先出地腾地方。
 */
async function evictOldest(cache, count) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, count).map((key) => cache.delete(key)))
}

// 超过上限就从头删。
async function trim(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_ENTRIES) return
  await evictOldest(cache, keys.length - MAX_ENTRIES)
}

// 页面通知的清理：把一张坏图从缓存里删掉。
async function evict(url) {
  if (!url) return
  const cache = await caches.open(CACHE_NAME)
  await cache.delete(url)
}
