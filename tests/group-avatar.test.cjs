/**
 * 群头像的验收脚本。
 *
 * 覆盖：
 *   1. 群主能在会话详情里看到「设置群头像」入口
 *   2. 非群主看不到这个入口
 *   3. 群头像上传后写进后端，列表和聊天头部都显示出来
 *   4. 上传的是别的群的目录 → 后端拒
 *
 * 用法：source tests/chromium-env.sh && node tests/group-avatar.test.cjs
 */

const { chromium } = require('/home/lhb/.npm-global/lib/node_modules/playwright')
const fs = require('fs')
const path = require('path')

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
  await page.locator('.auth-switch button').click()
  await page.waitForTimeout(300)
  await page.locator('.auth-form input[type="text"]').first().fill(username)
  await page.locator('.auth-form input[type="password"]').fill(password)
  await page.locator('.auth-form button[type="submit"]').click()
  await page.waitForTimeout(2200)
}

/** 拿当前登录用户的 user_id。 */
async function uiUserId(page) {
  return page.evaluate(async () => {
    const t = localStorage.getItem('chatroom.access_token') || localStorage.getItem('access_token')
    const r = await fetch('/api/user/info', {
      headers: { Authorization: `Bearer ${t}` },
    })
    const d = await r.json()
    return d.id || d.user_id
  })
}

/** 造一张 2x2 的 PNG，存到临时文件。 */
function makePng(file) {
  const zlib = require('zlib')
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : require('zlib').crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const w = 2, h = 2
  const raw = Buffer.concat([Buffer.from([0]), Buffer.from([255, 0, 0, 255, 0, 0, 255, 255])])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  fs.writeFileSync(file, png)
  return file
}

;(async () => {
  const browser = await chromium.launch()
  const su = Date.now()
  const pass = 'Passw0rd!123'
  const tmp = path.join('/tmp', `ga-${su}.png`)
  makePng(tmp)

  try {
    // --- 1. 两个用户 + 群 ---
    console.log('\n=== 1. 注册两个用户并建群 ===')
    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    await uiRegister(pageA, `ga${su}a`, pass)
    const uidA = await uiUserId(pageA)
    check('用户 A 注册并登录成功', !!uidA, uidA)

    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    await uiRegister(pageB, `ga${su}b`, pass)
    const uidB = await uiUserId(pageB)
    check('用户 B 注册并登录成功', !!uidB, uidB)

    // A 申请加 B，B 同意
    const fr = await pageA.evaluate(async (target) => {
      const t = localStorage.getItem('chatroom.access_token')
      const r = await fetch('/api/friend/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ target_id: target }),
      })
      return r.status
    }, uidB)
    check('A 发起好友申请', fr === 200 || fr === 409, String(fr))

    const accepted = await pageB.evaluate(async () => {
      const t = localStorage.getItem('chatroom.access_token')
      const pending = await (await fetch('/api/friend/pending', {
        headers: { Authorization: `Bearer ${t}` },
      })).json()
      const id = (pending.requests || [])[0]?.id
      if (!id) return 'no-request'
      const r = await fetch('/api/friend/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ request_id: id }),
      })
      return r.status
    })
    check('B 同意好友申请', accepted === 200, String(accepted))

    // 建群
    const conv = await pageA.evaluate(async (member) => {
      const t = localStorage.getItem('chatroom.access_token')
      const r = await fetch('/api/conversation/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ type: 2, member_ids: [member], name: '群头像验收群' }),
      })
      const d = await r.json()
      return d.conversation?.id
    }, uidB)
    check('A 建群成功', !!conv, `conversation_id=${conv}`)

    // --- 2. 群主能看到入口 ---
    console.log('\n=== 2. 群主能看到「设置群头像」 ===')
    await pageA.goto(BASE, { waitUntil: 'domcontentloaded' })
    await pageA.waitForTimeout(2500)
    // 打开会话详情 —— 按群名点，别点列表第一个（可能有别的会话排前面）
    await pageA.locator('.conversation-item', { hasText: '群头像验收群' }).first().click()
    await pageA.waitForTimeout(800)
    await pageA.locator('button[title="会话详情"]').click()
    await pageA.waitForTimeout(1200)
    const modalTitle = await pageA.locator('.modal-title').first().textContent().catch(() => '')
    check('会话详情弹窗打开', /群聊信息|会话信息/.test(modalTitle || ''), modalTitle || '(无)')

    const ownerHasEntry = await pageA.locator('button:has-text("设置群头像")').count()
    check('群主能看到「设置群头像」入口', ownerHasEntry > 0, `count=${ownerHasEntry}`)

    // --- 3. 上传群头像 ---
    console.log('\n=== 3. 上传群头像 ===')
    const fileInput = pageA.locator('.modal input[type="file"]').first()
    await fileInput.setInputFiles(tmp)
    await pageA.waitForTimeout(4000)

    const convAfter = await pageA.evaluate(async (id) => {
      const t = localStorage.getItem('chatroom.access_token')
      const r = await fetch(`/api/conversation/get?id=${id}`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      const d = await r.json()
      return d.conversation?.avatar || ''
    }, conv)
    check('后端已写入群头像地址', convAfter.includes('group_avatar'), convAfter)

    // CDN 能取到 —— 用 Image 加载而不是 fetch：
    // CDN 不发 CORS 头，fetch 会被浏览器拦掉，但 <img> 加载不受影响。
    const cdn = await pageA.evaluate(
      (url) =>
        new Promise((resolve) => {
          const img = new Image()
          img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight })
          img.onerror = () => resolve({ ok: false })
          img.src = url
        }),
      convAfter,
    ).catch((e) => ({ ok: false, err: String(e) }))
    check('CDN 能取到群头像', cdn.ok === true, JSON.stringify(cdn))

    // 列表和聊天头部显示
    await pageA.locator('.modal-close, .modal .close').first().click().catch(() => {})
    await pageA.waitForTimeout(1500)
    const listImg = await pageA.locator('.conversation-item img.avatar-img').first().getAttribute('src').catch(() => null)
    check('会话列表显示群头像', !!listImg && listImg.includes('group_avatar'), listImg || '(无)')

    const headerImg = await pageA.locator('.chat-header img.avatar-img').first().getAttribute('src').catch(() => null)
    check('聊天头部显示群头像', !!headerImg && headerImg.includes('group_avatar'), headerImg || '(无)')

    // --- 4. 非群主看不到入口 ---
    console.log('\n=== 4. 非群主看不到入口 ===')
    await pageB.goto(BASE, { waitUntil: 'domcontentloaded' })
    await pageB.waitForTimeout(2500)
    await pageB.locator('.conversation-item', { hasText: '群头像验收群' }).first().click()
    await pageB.waitForTimeout(800)
    await pageB.locator('button[title="会话详情"]').click()
    await pageB.waitForTimeout(1200)
    const nonOwnerHasEntry = await pageB.locator('button:has-text("设置群头像")').count()
    check('非群主看不到「设置群头像」入口', nonOwnerHasEntry === 0, `count=${nonOwnerHasEntry}`)

    // --- 5. 越权：非群主调后端也要被拒 ---
    console.log('\n=== 5. 后端越权校验 ===')
    const denied = await pageB.evaluate(async (id) => {
      const t = localStorage.getItem('chatroom.access_token')
      const r = await fetch('/api/conversation/avatar/upload_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ conversation_id: id, ext: 'png' }),
      })
      const d = await r.json()
      return { status: r.status, reason: d.reason }
    }, conv)
    check('非群主签凭证被拒', denied.status === 403 && denied.reason === 'CONVERSATION_NOT_OWNER', JSON.stringify(denied))
  } catch (e) {
    console.error('脚本异常：', e)
    failures++
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
    await browser.close()
  }

  console.log('\n==================================================')
  console.log(`通过 ${results.length - failures} / ${results.length}`)
  process.exit(failures > 0 ? 1 : 0)
})()
