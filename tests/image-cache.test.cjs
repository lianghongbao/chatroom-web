/**
 * 聊天图片本地缓存的验收脚本。
 *
 * 跑的是仓库里真实的 public/sw.js —— 改坏了这里能立刻发现。
 *
 * 验三件事：
 *   1. 跨域图片（OSS / CDN 那样的）会被存进本地缓存
 *   2. 断网重开，图片照样显示 —— 走的是本地缓存，不是网络
 *   3. 加载失败的图片会被踢出缓存 —— 否则一次 404 变成永久裂图
 *
 * 用法：source tests/chromium-env.sh && node tests/image-cache.test.cjs
 */

const { chromium } = require('/home/lhb/.npm-global/lib/node_modules/playwright')
const http = require('http')
const fs = require('fs')
const path = require('path')

const SW_PATH = path.join(__dirname, '..', 'public', 'sw.js')
const PAGE_PORT = 8891
const IMAGE_PORT = 8892

const results = []
let failures = 0

function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures++
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// 1x1 的 png。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

// 测试页：一个跨域图片 + 一个加载失败的跨域图片。
//
// 加载失败时通知 worker 删掉这条 —— 跟应用里 MessageBubble 的 onError 一样
//（src/utils/imageCache.ts 的 evictImage）。
const PAGE = `<!doctype html>
<html><body>
<img id="pic" src="http://127.0.0.1:${IMAGE_PORT}/photo.png">
<img id="broken" src="http://127.0.0.1:${IMAGE_PORT}/missing.png">
<script>
navigator.serviceWorker.register('/sw.js')
document.getElementById('broken').addEventListener('error', (e) => {
  navigator.serviceWorker.ready.then((reg) => {
    reg.active.postMessage({ type: 'evict', url: e.target.src })
  })
})
</script>
</body></html>`

/** 起两个端口 —— 不同端口就是不同源，图片才是「跨域」的。 */
function startServers() {
  const pageServer = http.createServer((req, res) => {
    if (req.url.startsWith('/sw.js')) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache',
      })
      return res.end(fs.readFileSync(SW_PATH))
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(PAGE)
  })

  const imageServer = http.createServer((req, res) => {
    // 不带 CORS 头 —— 跟 OSS / CDN 一样，浏览器只能拿到 opaque 响应。
    if (req.url.startsWith('/missing')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('not found')
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': PNG.length,
    })
    res.end(PNG)
  })

  return Promise.all([
    new Promise((r) => pageServer.listen(PAGE_PORT, '127.0.0.1', r)),
    new Promise((r) => imageServer.listen(IMAGE_PORT, '127.0.0.1', r)),
  ])
}

/** 缓存里现在有几条记录。 */
function cacheEntries(page) {
  return page.evaluate(async () => {
    const names = await caches.keys()
    const urls = []
    for (const name of names) {
      if (!name.startsWith('chatroom-img-')) continue
      const cache = await caches.open(name)
      for (const req of await cache.keys()) urls.push(req.url)
    }
    return urls
  })
}

async function main() {
  await startServers()

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const page = await ctx.newPage()

  // 第一次打开：worker 注册 + 接管。
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)

  // 第二次打开：worker 已经在管事，图片请求会经过 fetch 事件。
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  const shown = await page.evaluate(() => {
    const pic = document.getElementById('pic')
    return {
      natural: pic.naturalWidth,
      controlled: !!navigator.serviceWorker.controller,
    }
  })
  check('图片正常显示', shown.natural > 0, `naturalWidth=${shown.natural}`)
  check('Service Worker 已接管页面', shown.controlled)

  const entries = await cacheEntries(page)
  check(
    '跨域图片进了本地缓存',
    entries.some((u) => u.includes('/photo.png')),
    `${entries.length} 条：${entries.join(', ')}`,
  )

  // 断网重开 —— 图片只能来自本地缓存。
  await ctx.route(`**/photo.png`, (route) => route.abort())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const offline = await page.evaluate(() => {
    const pic = document.getElementById('pic')
    return pic.naturalWidth
  })
  check('断网后图片照样显示（走本地缓存）', offline > 0, `naturalWidth=${offline}`)
  await ctx.unroute(`**/photo.png`)

  // 404 的图不能留在缓存里 —— 不然后面每次都是裂图。
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const afterBroken = await cacheEntries(page)
  check(
    '加载失败的图片被踢出缓存',
    !afterBroken.some((u) => u.includes('/missing.png')),
    afterBroken.join(', '),
  )

  await browser.close()

  console.log(
    failures === 0
      ? `\n全部通过（${results.length} 项）`
      : `\n${failures} 项失败 / 共 ${results.length} 项`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
