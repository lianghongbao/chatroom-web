/**
 * 聊天图片的本地缓存 —— 页面侧。
 *
 * 缓存本体在 Service Worker 里（public/sw.js），
 * 这一侧只做三件事：注册 worker、清缓存、通知 worker 删掉坏图。
 */

/** 缓存名前缀。跟 sw.js 里的 CACHE_PREFIX 对齐。 */
const CACHE_PREFIX = 'chatroom-img-'

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

/** 本地缓存里现在有几张图。 */
export async function imageCacheCount(): Promise<number> {
  if (typeof window === 'undefined' || !('caches' in window)) return 0
  const names = await caches.keys()
  let count = 0
  for (const name of names) {
    if (!name.startsWith(CACHE_PREFIX)) continue
    const cache = await caches.open(name)
    count += (await cache.keys()).length
  }
  return count
}

/** 清空本地图片缓存。 */
export async function clearImageCache(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return
  const names = await caches.keys()
  await Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
  )
}
