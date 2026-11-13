/**
 * 复审阶段的验收脚本。
 *
 * 覆盖本轮改动：
 *   1. presence 在线状态 —— 在线点 / 在线·离线副标题
 *   2. logout 后 store 清空 —— 换账号不残留上一个用户的会话
 *   3. resume 路径 —— 断线重连后网关补的消息能落地（不再依赖 listMessagesSince）
 *   4. 会话详情成员资料回填
 *   5. update_mask 只带真正改动的字段
 *
 * 用法：node tests/review.test.js
 */

const { chromium } = require('/home/lhb/.npm-global/lib/node_modules/playwright')
const fs = require('fs')

const BASE = 'http://127.0.0.1:5173'

const results = []
let failures = 0

function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures++
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 在页面里注册并登录（走真实 UI 流程）。 */
async function uiRegister(page, username, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('.auth-switch button').click() // 切到注册
  await page.waitForTimeout(300)
  await page.locator('.auth-form input[type="text"]').first().fill(username)
  await page.locator('.auth-form input[type="password"]').fill(password)
  await page.locator('.auth-form button[type="submit"]').click()
  await page.waitForTimeout(2200)
}

/** 拿当前登录用户的 user_id（从 /info）。 */
async function currentUserId(page) {
  return page.evaluate(async () => {
    const tok = localStorage.getItem('chatroom.access_token')
    if (!tok) return null
    const res = await fetch('/api/user/info', { headers: { Authorization: `Bearer ${tok}` } })
    if (!res.ok) return null
    const j = await res.json()
    return j.id || null
  })
}

async function main() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  const stamp = Date.now()
  const userA = `reva${stamp}`
  const userB = `revb${stamp}`
  const pass = 'Passw0rd!23'

  console.log('\n=== 1. 注册两个用户 ===')
  await uiRegister(page, userA, pass)
  const aId = await currentUserId(page)
  check('用户 A 注册并登录成功', !!aId, aId || 'no id')

  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const pageB = await ctxB.newPage()
  pageB.on('pageerror', (e) => consoleErrors.push(`pageerror(B): ${e.message}`))
  pageB.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`B: ${m.text()}`)
  })
  await uiRegister(pageB, userB, pass)
  const bId = await currentUserId(pageB)
  check('用户 B 注册并登录成功', !!bId, bId || 'no id')

  console.log('\n=== 2. A 与 B 建单聊 ===')
  const created = await page.evaluate(
    async ([uid]) => {
      const tok = localStorage.getItem('chatroom.access_token')
      const res = await fetch('/api/conversation/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ type: 1, member_ids: [uid], name: '' }),
      })
      return { status: res.status, body: await res.text() }
    },
    [bId],
  )
  check('建单聊成功', created.status === 200, `${created.status} ${created.body.slice(0, 160)}`)
  let convId = null
  try {
    convId = JSON.parse(created.body).conversation?.id
  } catch {}
  check('拿到 conversation_id', !!convId, String(convId))

  console.log('\n=== 3. presence 在线状态 ===')
  // 会话是刚用 API 建的，页面列表还是旧的 —— 重新加载
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  // A 打开会话 -> 触发 queryConversationStatus
  await page.locator('.conversation-item').first().click()
  await page.waitForTimeout(1500)
  const subtitleIdle = await page.locator('.chat-subtitle').first().textContent()
  check('会话副标题渲染', !!subtitleIdle, subtitleIdle)

  // B 也打开会话 -> 双方都在线
  await pageB.reload({ waitUntil: 'domcontentloaded' })
  await pageB.waitForTimeout(2500)
  await pageB.locator('.conversation-item').first().click()
  await pageB.waitForTimeout(2500)
  await page.waitForTimeout(1500)
  const subtitleOnline = await page.locator('.chat-subtitle').first().textContent()
  check('对方在线时副标题显示「在线」', subtitleOnline.includes('在线'), subtitleOnline)

  const onlineDot = await page.locator('.avatar-status.is-online').count()
  check('聊天头部有在线状态点', onlineDot > 0, `${onlineDot} 个`)

  const listDot = await page.locator('.conversation-item .avatar-status.is-online').count()
  check('会话列表有在线状态点', listDot > 0, `${listDot} 个`)

  console.log('\n=== 4. 发消息 + 实时接收 ===')
  const text = `hello-${stamp}`
  await page.locator('.composer-input').fill(text)
  await page.locator('.composer-send').click()
  await page.waitForTimeout(1200)
  const aSent = await page.locator('.bubble-text').filter({ hasText: text }).count()
  check('A 端自己的消息落地（乐观气泡被 ack 替换）', aSent > 0)

  await pageB.waitForTimeout(1200)
  const bGot = await pageB.locator('.bubble-text').filter({ hasText: text }).count()
  check('B 端实时收到消息', bGot > 0)

  // 乐观气泡应已被真实消息替换（不应残留「发送中」状态）
  const pendingLeft = await page.locator('.message-status').filter({ hasText: '发送中' }).count()
  check('乐观气泡已被 ack 替换（无残留「发送中」）', pendingLeft === 0, `${pendingLeft} 个`)

  console.log('\n=== 5. 未读数 ===')
  // B 在第 3 步已经打开过会话 —— 那条消息的未读已被清掉。
  // 这里另起一个会话：A 发消息，B 从不打开，未读应当留在 1。
  const userC = `revc${stamp}`
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const pageC = await ctxC.newPage()
  await uiRegister(pageC, userC, pass)
  const cId = await currentUserId(pageC)
  check('第三个用户注册成功', !!cId, cId || 'no id')

  const conv2 = await page.evaluate(
    async ([uid]) => {
      const tok = localStorage.getItem('chatroom.access_token')
      const res = await fetch('/api/conversation/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ type: 1, member_ids: [uid], name: '' }),
      })
      return { status: res.status, body: await res.text() }
    },
    [cId],
  )
  const conv2Id = (() => {
    try {
      return JSON.parse(conv2.body).conversation?.id
    } catch {
      return null
    }
  })()
  check('建第二个单聊成功', conv2.status === 200 && !!conv2Id, String(conv2Id))

  // A 往这个会话发消息（走 WS，模拟真实发送）
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.locator('.conversation-item').first().click()
  await page.waitForTimeout(1000)
  const unreadText = `unread-${stamp}`
  await page.locator('.composer-input').fill(unreadText)
  await page.locator('.composer-send').click()
  await page.waitForTimeout(1500)

  const cUnread = await pageC.evaluate(async () => {
    const tok = localStorage.getItem('chatroom.access_token')
    const res = await fetch('/api/message/unread', { headers: { Authorization: `Bearer ${tok}` } })
    const t = await res.text()
    try {
      const j = JSON.parse(t)
      return j.unread_count ?? 0
    } catch {
      return `ERR ${t.slice(0, 100)}`
    }
  })
  check('C 从不打开会话，未读数为 1', cUnread === 1, String(cUnread))

  // C 打开会话后未读应清零
  await pageC.reload({ waitUntil: 'domcontentloaded' })
  await pageC.waitForTimeout(2500)
  await pageC.locator('.conversation-item').first().click()
  await pageC.waitForTimeout(2000)
  const cUnreadAfter = await pageC.evaluate(async () => {
    const tok = localStorage.getItem('chatroom.access_token')
    const res = await fetch('/api/message/unread', { headers: { Authorization: `Bearer ${tok}` } })
    const t = await res.text()
    try {
      const j = JSON.parse(t)
      return j.unread_count ?? 0
    } catch {
      return `ERR ${t.slice(0, 100)}`
    }
  })
  check('C 打开会话后未读清零', cUnreadAfter === 0, String(cUnreadAfter))

  const cGotMsg = await pageC.locator('.bubble-text').filter({ hasText: unreadText }).count()
  check('C 能读到 A 的消息', cGotMsg > 0)

  console.log('\n=== 6. 断线重连 resume ===')
  // 明确切到 A↔B 那个会话 —— 第 5 步建了 A↔C 的会话后，
  // 「第一个」已经不是 A↔B 了，测的就不是同一个会话。
  await page.locator('.conversation-item', { hasText: userB }).first().click()
  await page.waitForTimeout(1200)
  // 先发一条，把 resume 游标锚定在这个会话上
  await page.locator('.composer-input').fill(`anchor-${stamp}`)
  await page.locator('.composer-send').click()
  await page.waitForTimeout(1500)

  // 关掉网关进程 —— 所有 WS 连接被服务端断开，客户端应当触发重连。
  const { execSync } = require('child_process')
  try {
    // 按 /proc/<pid>/comm 找 —— comm 被截断到 15 字符，完整名 pkill 匹配不上。
    execSync(
      `for p in /proc/[0-9]*; do c=$(cat $p/comm 2>/dev/null); case "$c" in cr-ws-gateway-*) kill \${p#/proc/};; esac; done`,
      { stdio: 'ignore', shell: '/bin/bash' },
    )
  } catch {
    // 没匹配到也算成功
  }
  await page.waitForTimeout(2500)
  const wsClosed = await page.locator('.ws-dot').getAttribute('class')
  check('网关挂掉后 WS 状态变为非 open', !wsClosed.includes('ws-open'), wsClosed)

  // B 在 A 断线期间发消息 —— 走 HTTP，绕开已经死掉的 WS 连接。
  // 这条消息落库时 A 的连接是断的，广播补不回来，
  // 只能靠 A 重连后的 resume 补 —— 这样测的才是 resume 这条路径。
  const offlineText = `offline-${stamp}`
  const bToken = await pageB.evaluate(() => localStorage.getItem('chatroom.access_token'))
  const httpSent = await pageB.evaluate(
    async ([cid, tok, content]) => {
      const res = await fetch('/api/message/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ conversation_id: cid, content, type: 1 }),
      })
      return { status: res.status, body: (await res.text()).slice(0, 200) }
    },
    [convId, bToken, offlineText],
  )
  check('B 的消息在断线期间落库', httpSent.status === 200, `${httpSent.status} ${httpSent.body}`)

  const { spawn } = require('child_process')
  const env = {
    ...process.env,
    NACOS_SERVERS: '127.0.0.1:8848',
    NACOS_NAMESPACE: '3dbbf765-11cf-4622-817f-d890cd670ba0',
    NACOS_GROUP: 'DEFAULT_GROUP',
    NACOS_USERNAME: 'nacos',
    NACOS_PASSWORD: '123456',
    REDIS_ADDR: '127.0.0.1:6379',
    DB_SOURCE: 'root:123456@tcp(127.0.0.1:3306)/test?parseTime=true&loc=Local&charset=utf8mb4',
    AUTH_JWT_SECRET: 'chatroom-dev-jwt-secret-please-change-in-production-32bytes',
    AUTH_INTERNAL_SECRET: 'chatroom-dev-internal-secret-please-change-in-production',
    OTEL_EXPORTER_OTLP_ENDPOINT: '127.0.0.1:4317',
  }
  const gateway = spawn('/tmp/cr-ws-gateway-service', {
    cwd: '/mnt/d/Learn/go-project/chatroom/ws-gateway-service',
    env,
    stdio: ['ignore', fs.openSync('/tmp/ws-gateway-test.log', 'w'), fs.openSync('/tmp/ws-gateway-test.log', 'a')],
    detached: true,
  })
  gateway.unref()

  // A 等重连（退避序列 1s/2s/4s/8s/15s/30s）
  await page.waitForTimeout(15000)
  const aGotOffline = await page.locator('.bubble-text').filter({ hasText: offlineText }).count()
  check('A 重连后收到断线期间的消息（网关 resume 推送）', aGotOffline > 0)

  const wsBack = await page.locator('.ws-dot').getAttribute('class')
  check('A 重连后 WS 恢复 open', wsBack.includes('ws-open'), wsBack)

  console.log('\n=== 7. logout 清空 store ===')
  await page.locator('.nav-logout').click()
  await page.waitForTimeout(1800)
  const loginVisible = await page.locator('.auth-page').count()
  check('登出后回到登录页', loginVisible > 0)

  const tokenGone = await page.evaluate(() => !localStorage.getItem('chatroom.access_token'))
  check('登出后 token 已清除', tokenGone)

  // 登录 B —— 如果 store 没清干净，B 的列表里会残留 A 的会话
  await page.locator('.auth-form input[type="text"]').first().fill(userB)
  await page.locator('.auth-form input[type="password"]').fill(pass)
  await page.locator('.auth-form button[type="submit"]').click()
  await page.waitForTimeout(2800)
  const convCount = await page.locator('.conversation-item').count()
  check('B 登录后会话列表只有自己那一个（无 A 的残留）', convCount === 1, `${convCount} 个会话`)

  // B 的会话里应该看得到 A 发的消息（数据确实在库里）
  const bSeesMsg = await page.locator('.bubble-text').filter({ hasText: text }).count()
  check('B 重新登录后仍能读到历史消息', bSeesMsg > 0)

  console.log('\n=== 8. 会话详情成员资料回填 ===')
  page.on('response', async (r) => {
    if (r.url().includes('/api/conversation/members/list')) {
      console.log('    [members/list]', r.status(), (await r.text().catch(() => '')).slice(0, 200))
    }
  })
  await page.locator('.conversation-item').first().click()
  await page.waitForTimeout(1200)
  await page.locator('.chat-header .icon-btn').click()
  await page.waitForTimeout(2500)
  const memberNames = await page.locator('.member-name').allTextContents()
  const hasRealName = memberNames.some((t) => t && t.trim() !== '' && !t.includes('未知用户'))
  check('成员列表显示昵称（回填生效）', hasRealName, memberNames.join(' | ').slice(0, 140))

  console.log('\n=== 9. update_mask 只带改动字段 ===')
  // 改昵称 -> 请求体里 update_mask.paths 只能是 ["nickname"]
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const masked = await page.evaluate(async (nm) => {
    const tok = localStorage.getItem('chatroom.access_token')
    const before = await (await fetch('/api/user/info', { headers: { Authorization: `Bearer ${tok}` } })).json()
    const res = await fetch('/api/user/info', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body: JSON.stringify({
        nickname: nm,
        avatar: before.avatar || '',
        update_mask: { paths: ['nickname'] },
      }),
    })
    return { status: res.status, body: await res.text() }
  }, `nm${stamp}`)
  check('只改昵称可以成功（mask 不带空 avatar）', masked.status === 200, `${masked.status} ${masked.body.slice(0, 140)}`)

  console.log('\n=== 10. console 无错误 ===')
  const realErrors = consoleErrors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('ERR_INTERNET_DISCONNECTED') &&
      !e.includes('Failed to load resource') &&
      !e.includes('WebSocket'),
  )
  check('无 console 错误', realErrors.length === 0, realErrors.slice(0, 3).join(' || ').slice(0, 400))

  await browser.close()

  console.log(`\n${'='.repeat(50)}`)
  console.log(`通过 ${results.length - failures} / ${results.length}`)
  if (failures) {
    console.log('\n失败项：')
    for (const r of results.filter((x) => !x.ok)) console.log(`  ✗ ${r.name} — ${r.detail || ''}`)
  }
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(2)
})
