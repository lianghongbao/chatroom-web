/**
 * 群名 / 群头像的验收脚本。
 *
 * 交互设计：
 *   - 聊天界面**左上角**（群头像 + 群名）是**纯展示**，不能改
 *   - 改的入口在右上角的「群聊信息」面板里：
 *     头像右下角有相机角标 → 点它上传
 *     群名旁边有铅笔 → 点它就地改名
 *   - 只有群主能改，非群主看不到任何入口
 *   - 改完之后不白屏 —— 返回的会话必须带成员资料
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
    crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const w = 2, h = 2
  const raw = Buffer.concat([Buffer.from([0]), Buffer.from([255, 0, 0, 255, 0, 0, 255, 255])])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  fs.writeFileSync(file, png)
  return file
}

/** 关掉群聊信息弹窗。 */
async function closeModal(page) {
  await page.locator('.modal button[aria-label="关闭"], .modal-close').first().click().catch(() => {})
  await page.waitForTimeout(900)
}

;(async () => {
  const browser = await chromium.launch()
  const su = Date.now()
  const pass = 'Passw0rd!123'
  const tmp = path.join('/tmp', `ga-${su}.png`)
  makePng(tmp)
  const pageErrors = []

  try {
    // --- 1. 两个用户 + 群 ---
    console.log('\n=== 1. 注册两个用户并建群 ===')
    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    pageA.on('pageerror', (e) => pageErrors.push(e.message))
    await uiRegister(pageA, `ga${su}a`, pass)
    const uidA = await uiUserId(pageA)
    check('用户 A 注册并登录成功', !!uidA, uidA)

    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    pageB.on('pageerror', (e) => pageErrors.push(e.message))
    await uiRegister(pageB, `ga${su}b`, pass)
    const uidB = await uiUserId(pageB)
    check('用户 B 注册并登录成功', !!uidB, uidB)

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

    // --- 2. 聊天界面左上角是纯展示 ---
    console.log('\n=== 2. 聊天界面左上角不能改 ===')
    await pageA.goto(BASE, { waitUntil: 'domcontentloaded' })
    await pageA.waitForTimeout(2500)
    await pageA.locator('.conversation-item', { hasText: '群头像验收群' }).first().click()
    await pageA.waitForTimeout(1000)

    const headerBadge = await pageA.locator('.chat-header .avatar-badge').count()
    check('聊天头部没有相机角标', headerBadge === 0, `count=${headerBadge}`)
    const headerFileInput = await pageA.locator('.chat-header input[type="file"]').count()
    check('聊天头部没有头像上传入口', headerFileInput === 0, `count=${headerFileInput}`)
    const headerPencil = await pageA.locator('.chat-header .group-name-edit').count()
    check('聊天头部群名旁边没有铅笔', headerPencil === 0, `count=${headerPencil}`)
    const headerEditable = await pageA.locator('.chat-header .is-editable').count()
    check('聊天头部没有可编辑的元素', headerEditable === 0, `count=${headerEditable}`)
    const headerTitle = await pageA.locator('.chat-header .chat-title').textContent()
    check('群名照常显示', headerTitle === '群头像验收群', headerTitle || '(无)')

    // --- 3. 群聊信息面板里能改 ---
    console.log('\n=== 3. 群聊信息面板里能改 ===')
    await pageA.locator('button[title="会话详情"]').click()
    await pageA.waitForTimeout(1200)

    const panelBadge = await pageA.locator('.modal .avatar-badge').count()
    check('面板里的头像有相机角标', panelBadge === 1, `count=${panelBadge}`)
    const panelFileInput = await pageA.locator('.modal input[type="file"]').count()
    check('面板里有头像上传入口', panelFileInput === 1, `count=${panelFileInput}`)
    const panelPencil = await pageA.locator('.modal .group-name-edit').count()
    check('面板里的群名旁边有铅笔', panelPencil === 1, `count=${panelPencil}`)
    const panelEditable = await pageA.locator('.modal .details-group-name.is-editable').count()
    check('面板里的群名可点', panelEditable === 1, `count=${panelEditable}`)

    // 群管理区只留低频操作
    const renameBtn = await pageA.locator('.modal button:has-text("修改群名")').count()
    const avatarBtn = await pageA.locator('.modal button:has-text("设置群头像")').count()
    check('面板里没有「修改群名」按钮', renameBtn === 0, `count=${renameBtn}`)
    check('面板里没有「设置群头像」按钮', avatarBtn === 0, `count=${avatarBtn}`)
    const transferBtn = await pageA.locator('.modal button:has-text("转让群主")').count()
    check('面板里保留了「转让群主」', transferBtn > 0, `count=${transferBtn}`)

    // --- 4. 在面板里改群名 ---
    console.log('\n=== 4. 在面板里改群名 ===')
    await pageA.locator('.modal .group-name-edit').click()
    await pageA.waitForTimeout(600)
    const panelInput = await pageA.locator('.modal .details-group-name-input').count()
    check('点铅笔后面板里出现输入框', panelInput === 1, `count=${panelInput}`)

    await pageA.locator('.modal .details-group-name-input').fill('改过的群名')
    await pageA.keyboard.press('Enter')
    await pageA.waitForTimeout(2000)

    const panelName = await pageA.locator('.modal .details-group-name').textContent()
    check('面板里群名已更新', panelName === '改过的群名', panelName || '(无)')
    const headerAfter = await pageA.locator('.chat-header .chat-title').textContent()
    check('聊天头部的群名同步更新', headerAfter === '改过的群名', headerAfter || '(无)')
    const listName = await pageA
      .locator('.conversation-item.is-active .conversation-name')
      .textContent()
      .catch(() => null)
    check('会话列表里的群名也更新了', listName === '改过的群名', listName || '(无)')
    const backendName = await pageA.evaluate(async () => {
      const t = localStorage.getItem('chatroom.access_token')
      const l = await (await fetch('/api/conversation/list', {
        headers: { Authorization: `Bearer ${t}` },
      })).json()
      const c = l.conversations.find((x) => x.name === '改过的群名')
      return c ? c.name : '(没找到)'
    })
    check('后端存的是新群名', backendName === '改过的群名', backendName)

    // --- 5. 在面板里换群头像 ---
    console.log('\n=== 5. 在面板里换群头像 ===')
    await pageA.locator('.modal input[type="file"]').first().setInputFiles(tmp)
    await pageA.waitForTimeout(6000)

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
    const cdn = await pageA
      .evaluate(
        (url) =>
          new Promise((resolve) => {
            const img = new Image()
            img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight })
            img.onerror = () => resolve({ ok: false })
            img.src = url
          }),
        convAfter,
      )
      .catch((e) => ({ ok: false, err: String(e) }))
    check('CDN 能取到群头像', cdn.ok === true, JSON.stringify(cdn))

    const panelImg = await pageA
      .locator('.modal .details-group-header img.avatar-img')
      .first()
      .getAttribute('src')
      .catch(() => null)
    check('面板里显示新的群头像', !!panelImg && panelImg.includes('group_avatar'), panelImg || '(无)')

    // --- 6. 不白屏 ---
    console.log('\n=== 6. 改完之后不白屏 ===')
    const rootAlive = await pageA.evaluate(() => document.getElementById('root')?.children.length ?? 0)
    check('页面根节点还在（没白屏）', rootAlive > 0, `root children=${rootAlive}`)
    check('没有 JS 异常', pageErrors.length === 0, pageErrors.join(' | ') || '无')

    await closeModal(pageA)

    // --- 7. 非群主不能改 ---
    console.log('\n=== 7. 非群主不能改 ===')
    await pageB.goto(BASE, { waitUntil: 'domcontentloaded' })
    await pageB.waitForTimeout(2500)
    await pageB.locator('.conversation-item', { hasText: '改过的群名' }).first().click()
    await pageB.waitForTimeout(1000)

    const nonOwnerHeaderBadge = await pageB.locator('.chat-header .avatar-badge').count()
    check('非群主在聊天头部看不到角标', nonOwnerHeaderBadge === 0, `count=${nonOwnerHeaderBadge}`)

    await pageB.locator('button[title="会话详情"]').click()
    await pageB.waitForTimeout(1200)
    const nonOwnerPanelBadge = await pageB.locator('.modal .avatar-badge').count()
    check('非群主在面板里看不到角标', nonOwnerPanelBadge === 0, `count=${nonOwnerPanelBadge}`)
    const nonOwnerPencil = await pageB.locator('.modal .group-name-edit').count()
    check('非群主在面板里看不到铅笔', nonOwnerPencil === 0, `count=${nonOwnerPencil}`)
    const nonOwnerEditable = await pageB.locator('.modal .details-group-name.is-editable').count()
    check('非群主的群名不可点', nonOwnerEditable === 0, `count=${nonOwnerEditable}`)
    const nonOwnerFileInput = await pageB.locator('.modal input[type="file"]').count()
    check('非群主在面板里也没有上传入口', nonOwnerFileInput === 0, `count=${nonOwnerFileInput}`)

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
    check(
      '非群主签凭证被拒',
      denied.status === 403 && denied.reason === 'CONVERSATION_NOT_OWNER',
      JSON.stringify(denied),
    )

    const deniedUpdate = await pageB.evaluate(async (id) => {
      const t = localStorage.getItem('chatroom.access_token')
      const r = await fetch('/api/conversation/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ conversation_id: id, name: '非群主改的名字', avatar: '' }),
      })
      const d = await r.json()
      return { status: r.status, reason: d.reason }
    }, conv)
    check(
      '非群主改群名被拒',
      deniedUpdate.status === 403 && deniedUpdate.reason === 'CONVERSATION_NOT_OWNER',
      JSON.stringify(deniedUpdate),
    )
  } catch (e) {
    console.error('脚本异常：', e)
    failures++
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {}
    await browser.close()
  }

  console.log('\n==================================================')
  console.log(`通过 ${results.length - failures} / ${results.length}`)
  process.exit(failures > 0 ? 1 : 0)
})()
