/**
 * 聊天图片的本地缓存 —— 页面侧。
 *
 * 缓存本体在 Service Worker 里（public/sw.js），
 * 这一侧只做三件事：注册 worker、告诉 worker 当前是谁、清缓存。
 */

/** 缓存名前缀。跟 sw.js 里的 CACHE_PREFIX 对齐。 */
const CACHE_PREFIX = 'chatroom-img-'

/** 缓存桶的版本号。改了缓存结构就升版本，老桶会被 worker 清掉。 */
const CACHE_VERSION = 'v2'

/**
 * 桶名 —— 按用户分桶。
 *
 * 为什么按用户分：缓存是**浏览器本地**的，不随账号走。
 * 同一台机器上 A 账号登录时缓存的图，B 账号登录后照样能命中
 * （Service Worker 是 cache-first，命中就不发网络请求）。
 * 那是另一个账号的聊天记录里的图 —— 不该让 B 看见。
 *
 * 顺带解决了一个界面误导：「清理图片缓存（5）」里的 5 原本是
 * **整个浏览器**的缓存总数，不是当前账号的。分桶后数字才对得上。
 */
function cacheNameFor(userId: string): string {
  return `${CACHE_PREFIX}${CACHE_VERSION}-${userId}`
}

/**
 * 注册 Service Worker。
 *
 * 注册失败（浏览器不支持 / 非 https / 策略限制）不影响使用 ——
 * 只是图片没有本地缓存而已。
 */
export function registerImageCache(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // 忽略：没有 Service Worker 也能正常聊天。
    })
  })
}

/**
 * 把当前登录用户告诉 Service Worker。
 *
 * worker 不知道「现在是谁登录的」—— 它只看到图片请求。
 * 页面这边知道，所以由页面主动告知，worker 据此选桶。
 *
 * 登出 / 换账号时都要调（传空串表示「没人登录」）：
 * 不换的话，上一个用户的图片请求会被存进新用户的桶里。
 */
export function syncImageCacheOwner(userId: string | null | undefined): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage({ type: 'owner', userId: userId ?? '' }))
    .catch(() => {
      // worker 没起来 —— 没有缓存可管，不用管。
    })
}

/**
 * 把一张加载失败的图片从本地缓存里踢掉。
 *
 * 跨域图片在 Service Worker 里是 opaque 响应，读不到状态码 ——
 * 404 也会被当成「成功」存下来，之后每次打开都是裂图。
 * 页面这边能看见 img 的 error 事件，由它来清理。
 */
export function evictImage(url: string): void {
  if (!url || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.ready
    .then((registration) => registration.active?.postMessage({ type: 'evict', url }))
    .catch(() => {
      // worker 没起来 —— 没有缓存可清，不用管。
    })
}

/**
 * 本地缓存里现在有几张图 —— **只算这个用户自己的**。
 *
 * userId 是当前登录用户的 uid；没登录传空 —— 没有用户就没有桶，
 * 返回 0。
 */
export async function imageCacheCount(userId: string | null | undefined): Promise<number> {
  if (typeof window === 'undefined' || !('caches' in window)) return 0
  if (!userId) return 0
  const cache = await caches.open(cacheNameFor(userId))
  return (await cache.keys()).length
}

/**
 * 清空本地图片缓存 —— **只清这个用户自己的**。
 *
 * 别的用户的缓存留着 —— 那是别人的聊天记录里的图，
 * 当前用户没理由也不能替他清。
 */
export async function clearImageCache(userId: string | null | undefined): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return
  if (!userId) return
  await caches.delete(cacheNameFor(userId))
}
