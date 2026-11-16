/**
 * 群名 / 群头像的验收脚本。
 *
 * 覆盖新的交互设计 —— 入口都在**聊天头部**，不在「群管理」面板里：
 *   1. 群主点群名就地变输入框，改完即生效（飞书那种交互）
 *   2. 群主点群头像直接弹系统选择器上传
 *   3. 非群主看到的是纯展示 —— 群名不可点，头像点了没反应
 *   4. 群管理面板里不再有「修改群名」「设置群头像」按钮
 *   5. 改完之后不白屏 —— 返回的会话必须带成员资料
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

    // --- 2. 群主在头部就地改群名 ---
    console.log('\n=== 2. 群主在聊天头部就地改群名 ===')
    await pageA.goto(BASE, { waitUntil: 'domcontentloaded' })
    await pageA.waitForTimeout(2500)
    // 按群名点，别点列表第一个（可能有别的会话排前面）
    await pageA.locator('.conversation-item', { hasText: '群头像验收群' }).first().click()
    await pageA.waitForTimeout(1000)

    const editableTitle = await pageA.locator('.chat-title.is-editable').count()
    check('群主的群名可点（带 is-editable 标记）', editableTitle > 0, `count=${editableTitle}`)

    // 群名旁边挂铅笔 —— 明说「群名能改」，不然用户以为群名是只读的
    const namePencil = await pageA.locator('.chat-header .group-name-edit').count()
    check('群名旁边有铅笔图标', namePencil === 1, `count=${namePencil}`)
    const pencilOpacity = await pageA
      .locator('.chat-header .group-name-edit')
      .evaluate((el) => getComputedStyle(el).opacity)
    check('铅笔不是 hover 才出现', Number(pencilOpacity) > 0.9, `opacity=${pencilOpacity}`)

    // 群头像右下角挂相机角标 —— 明说「点这里能换头像」
    const badgeCount = await pageA.locator('.avatar-badge').count()
    check('群主能看到群头像的相机角标', badgeCount === 1, `count=${badgeCount}`)

    await pageA.locator('.chat-title.is-editable').click()
    await pageA.waitForTimeout(500)
    const inputCount = await pageA.locator('.chat-title-input').count()
    check('点群名后就地变输入框', inputCount === 1, `count=${inputCount}`)

    // 铅笔也要能进编辑态
    await pageA.locator('.chat-title-input').fill('铅笔改的名')
    await pageA.keyboard.press('Escape')
    await pageA.waitForTimeout(600)
    await pageA.locator('.chat-header .group-name-edit').click()
    await pageA.waitForTimeout(600)
    const pencilInput = await pageA.locator('.chat-title-input').count()
    check('点铅笔也能进编辑态', pencilInput === 1, `count=${pencilInput}`)

    await pageA.locator('.chat-title-input').fill('改过的群名')
    await pageA.keyboard.press('Enter')
    await pageA.waitForTimeout(2000)

    const headerTitle = await pageA.locator('.chat-title').textContent()
    check('头部标题已更新', headerTitle === '改过的群名', headerTitle || '(无)')
    const listTitle = await pageA
      .locator('.conversation-item.is-active .conversation-name')
      .textContent()
      .catch(() => null)
    check('会话列表里的群名也更新了', listTitle === '改过的群名', listTitle || '(无)')
    const backendName = await pageA.evaluate(async () => {
      const t = localStorage.getItem('chatroom.access_token')
      const l = await (await fetch('/api/conversation/list', {
        headers: { Authorization: `Bearer ${t}` },
      })).json()
      const c = l.conversations.find((x) => x.name === '改过的群名')
      return c ? c.name : '(没找到) ' + l.conversations.map((x) => x.name).join(',')
    })
    check('后端存的是新群名', backendName === '改过的群名', backendName)

    // --- 3. 群主在头部换群头像 ---
    console.log('\n=== 3. 群主在聊天头部换群头像 ===')
    const headerFileInput = await pageA.locator('.chat-header input[type="file"]').count()
    check('头部有隐藏的文件选择框', headerFileInput > 0, `count=${headerFileInput}`)

    await pageA.locator('.chat-header input[type="file"]').first().setInputFiles(tmp)
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

    const headerImg = await pageA
      .locator('.chat-header img.avatar-img')
      .first()
      .getAttribute('src')
      .catch(() => null)
    check('聊天头部显示群头像', !!headerImg && headerImg.includes('group_avatar'), headerImg || '(无)')

    // --- 4. 不白屏 ---
    console.log('\n=== 4. 改完之后不白屏 ===')
    const rootAlive = await pageA.evaluate(() => document.getElementById('root')?.children.length ?? 0)
    check('页面根节点还在（没白屏）', rootAlive > 0, `root children=${rootAlive}`)
    check('没有 JS 异常', pageErrors.length === 0, pageErrors.join(' | ') || '无')

    // --- 5. 群管理面板里不再有改名字/头像的按钮 ---
    console.log('\n=== 5. 群管理面板里没有重复入口 ===')
    await pageA.locator('button[title="会话详情"]').click()
    await pageA.waitForTimeout(1200)
    const renameBtn = await pageA.locator('.modal button:has-text("修改群名")').count()
    const avatarBtn = await pageA.locator('.modal button:has-text("设置群头像")').count()
    check('群管理面板没有「修改群名」按钮', renameBtn === 0, `count=${renameBtn}`)
    check('群管理面板没有「设置群头像」按钮', avatarBtn === 0, `count=${avatarBtn}`)
    const transferBtn = await pageA.locator('.modal button:has-text("转让群主")').count()
    check('群管理面板保留了「转让群主」', transferBtn > 0, `count=${transferBtn}`)

    // --- 5b. 但「群聊信息」面板里的头像和群名本身就能改 ---
    console.log('\n=== 5b. 群聊信息面板里能改头像和群名 ===')
    const panelBadge = await pageA.locator('.modal .avatar-badge').count()
    check('群聊信息面板的头像有相机角标', panelBadge === 1, `count=${panelBadge}`)
    const panelFileInput = await pageA.locator('.modal input[type="file"]').count()
    check('群聊信息面板有头像上传入口', panelFileInput === 1, `count=${panelFileInput}`)
    const panelEditableName = await pageA.locator('.modal .details-group-name.is-editable').count()
    check('群聊信息面板的群名可点改', panelEditableName === 1, `count=${panelEditableName}`)

    // 在面板里改群名
    await pageA.locator('.modal .details-group-name.is-editable').click()
    await pageA.waitForTimeout(600)
    const panelInput = await pageA.locator('.modal .details-group-name-input').count()
    check('点群名后面板里出现输入框', panelInput === 1, `count=${panelInput}`)
    await pageA.locator('.modal .details-group-name-input').fill('面板改的群名')
    await pageA.keyboard.press('Enter')
    await pageA.waitForTimeout(2000)

    const panelName = await pageA.locator('.modal .details-group-name').textContent()
    check('面板里群名已更新', panelName === '面板改的群名', panelName || '(无)')
    const headerNameAfter = await pageA.locator('.chat-header .chat-title').textContent()
    check('聊天头部的群名同步更新', headerNameAfter === '面板改的群名', headerNameAfter || '(无)')
    const backendNameAfter = await pageA.evaluate(async () => {
      const t = localStorage.getItem('chatroom.access_token')
      const l = await (await fetch('/api/conversation/list', {
        headers: { Authorization: `Bearer ${t}` },
      })).json()
      const c = l.conversations.find((x) => x.name === '面板改的群名')
      return c ? c.name : '(没找到)'
    })
    check('后端存的也是新群名', backendNameAfter === '面板改的群名', backendNameAfter)

    // 面板里的头像上传 —— 走的是同一个组件，行为应该一致
    await pageA.locator('.modal input[type="file"]').first().setInputFiles(tmp)
    await pageA.waitForTimeout(6000)
    const avatarAfterPanel = await pageA.evaluate(async (id) => {
      const t = localStorage.getItem('chatroom.access_token')
      const r = await fetch(`/api/conversation/get?id=${id}`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      const d = await r.json()
      return d.conversation?.avatar || ''
    }, conv)
    check('从面板上传的群头像也写进了后端', avatarAfterPanel.includes('group_avatar'), avatarAfterPanel)

    await pageA.locator('.modal button:has-text("取消"), .modal-close').first().click().catch(() => {})
    await pageA.waitForTimeout(1000)

    // --- 6. 非群主不能改 ---
    console.log('\n=== 6. 非群主不能改 ===')
    await pageB.goto(BASE, { waitUntil: 'domcontentloaded' })
    await pageB.waitForTimeout(2500)
    // 群名在第 5b 步被改成「面板改的群名」了 —— 这里要用最新的名字
    await pageB.locator('.conversation-item', { hasText: '面板改的群名' }).first().click()
    await pageB.waitForTimeout(1000)

    const nonOwnerEditable = await pageB.locator('.chat-title.is-editable').count()
    check('非群主的群名不可点', nonOwnerEditable === 0, `count=${nonOwnerEditable}`)

    const nonOwnerPencil = await pageB.locator('.chat-header .group-name-edit').count()
    check('非群主看不到群名的铅笔', nonOwnerPencil === 0, `count=${nonOwnerPencil}`)

    const nonOwnerFileInput = await pageB.locator('.chat-header input[type="file"]').count()
    check('非群主看不到头像上传入口', nonOwnerFileInput === 0, `count=${nonOwnerFileInput}`)

    const nonOwnerBadge = await pageB.locator('.avatar-badge').count()
    check('非群主看不到相机角标', nonOwnerBadge === 0, `count=${nonOwnerBadge}`)

    // 群聊信息面板里同样没有入口
    await pageB.locator('button[title="会话详情"]').click()
    await pageB.waitForTimeout(1200)
    const nonOwnerPanelBadge = await pageB.locator('.modal .avatar-badge').count()
    check('非群主在群聊信息面板里也看不到角标', nonOwnerPanelBadge === 0, `count=${nonOwnerPanelBadge}`)
    const nonOwnerPanelEditable = await pageB.locator('.modal .details-group-name.is-editable').count()
    check('非群主在群聊信息面板里也不能改群名', nonOwnerPanelEditable === 0, `count=${nonOwnerPanelEditable}`)
    await pageB.locator('.modal button:has-text("取消"), .modal-close').first().click().catch(() => {})
    await pageB.waitForTimeout(800)

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
