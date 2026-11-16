/**
 * 好友列表交互的验收脚本。
 *
 * 新的交互设计（微信 / QQ / Telegram 那套）：
 *   1. 整行可点 = 发消息，不再有「发消息」按钮
 *   2. 不再有行尾的「删除」按钮 —— 破坏性操作收进「⋯」菜单
 *   3. 「⋯」菜单默认不显示，鼠标移到这一行才出现
 *   4. 菜单里的「删除好友」要再确认一次才真的删
 *   5. 点菜单外面自动收起
 *   6. 申请列表的「同意 / 拒绝」保持按钮 —— 那是主操作，不是次要操作
 *
 * 用法：source tests/chromium-env.sh && node tests/friends-list.test.cjs
 */

const { chromium } = require('/home/lhb/.npm-global/lib/node_modules/playwright')

const BASE = 'http://127.0.0.1:5173'

const results = []
let failures = 0

function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures++
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

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

async function uiUserId(page) {
  return page.evaluate(async () => {
    const t = localStorage.getItem('chatroom.access_token') || localStorage.getItem('access_token')
    const r = await fetch('/api/user/info', { headers: { Authorization: `Bearer ${t}` } })
    const d = await r.json()
    return d.id || d.user_id
  })
}

/** 走一遍完整的加好友流程，让 A 和 B 成为好友。 */
async function befriend(pageA, pageB, uidB) {
  await pageA.evaluate(async (target) => {
    const t = localStorage.getItem('chatroom.access_token')
    await fetch('/api/friend/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ target_id: target }),
    })
  }, uidB)

  await pageB.evaluate(async () => {
    const t = localStorage.getItem('chatroom.access_token')
    const pending = await (await fetch('/api/friend/pending', {
      headers: { Authorization: `Bearer ${t}` },
    })).json()
    const id = (pending.requests || [])[0]?.id
    if (id) {
      await fetch('/api/friend/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ request_id: id }),
      })
    }
  })
}

;(async () => {
  const browser = await chromium.launch()
  const su = Date.now()
  const pass = 'Passw0rd!123'
  const pageErrors = []

  try {
    console.log('\n=== 1. 造两个互为好友的用户 ===')
    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    pageA.on('pageerror', (e) => pageErrors.push(e.message))
    await uiRegister(pageA, `fr${su}a`, pass)
    const uidA = await uiUserId(pageA)

    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    pageB.on('pageerror', (e) => pageErrors.push(e.message))
    await uiRegister(pageB, `fr${su}b`, pass)
    const uidB = await uiUserId(pageB)

    await befriend(pageA, pageB, uidB)
    check('A 和 B 成为好友', true, uidB)

    // --- 2. 好友列表的静态结构 ---
    console.log('\n=== 2. 好友列表的结构 ===')
    await pageA.goto(BASE, { waitUntil: 'domcontentloaded' })
    await pageA.waitForTimeout(1500)
    // 切到「好友」页
    await pageA.locator('.nav-btn[title="好友"]').click()
    await pageA.waitForTimeout(1800)

    const itemCount = await pageA.locator('.friend-item').count()
    check('好友列表渲染出来了', itemCount > 0, `count=${itemCount}`)

    const sendBtn = await pageA.locator('.friend-item button:has-text("发消息")').count()
    check('行内没有「发消息」按钮了', sendBtn === 0, `count=${sendBtn}`)

    const delBtn = await pageA.locator('.friend-item button:has-text("删除")').count()
    check('行内没有「删除」按钮了', delBtn === 0, `count=${delBtn}`)

    const mainCount = await pageA.locator('.friend-item .friend-main').count()
    check('每行都有整行可点的主操作区', mainCount === itemCount, `${mainCount}/${itemCount}`)

    const triggerCount = await pageA.locator('.friend-item .friend-menu-trigger').count()
    check('每行都有「⋯」菜单触发器', triggerCount === itemCount, `${triggerCount}/${itemCount}`)

    // --- 3. 「⋯」默认隐藏，hover 才出现 ---
    console.log('\n=== 3. 「⋯」默认隐藏 ===')
    const opacityBefore = await pageA
      .locator('.friend-item .friend-menu-trigger')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity)
    check('「⋯」默认不可见', Number(opacityBefore) < 0.1, `opacity=${opacityBefore}`)

    await pageA.locator('.friend-item').first().hover()
    await pageA.waitForTimeout(500)
    const opacityAfter = await pageA
      .locator('.friend-item .friend-menu-trigger')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity)
    check('鼠标移上去「⋯」出现', Number(opacityAfter) > 0.9, `opacity=${opacityAfter}`)

    // --- 4. 菜单内容 ---
    console.log('\n=== 4. 菜单内容 ===')
    await pageA.locator('.friend-item .friend-menu-trigger').first().click()
    await pageA.waitForTimeout(500)
    const menuCount = await pageA.locator('.friend-menu').count()
    check('菜单展开了', menuCount === 1, `count=${menuCount}`)
    const menuSend = await pageA.locator('.friend-menu-item:has-text("发消息")').count()
    const menuDel = await pageA.locator('.friend-menu-item:has-text("删除好友")').count()
    check('菜单里有「发消息」', menuSend === 1, `count=${menuSend}`)
    check('菜单里有「删除好友」', menuDel === 1, `count=${menuDel}`)

    // --- 5. 点外面收起 ---
    console.log('\n=== 5. 点外面收起菜单 ===')
    await pageA.mouse.click(5, 5)
    await pageA.waitForTimeout(500)
    const menuAfterOutside = await pageA.locator('.friend-menu').count()
    check('点外面菜单收起了', menuAfterOutside === 0, `count=${menuAfterOutside}`)

    // --- 6. 删除要确认 ---
    console.log('\n=== 6. 删除好友要二次确认 ===')
    await pageA.locator('.friend-item .friend-menu-trigger').first().click()
    await pageA.waitForTimeout(500)
    await pageA.locator('.friend-menu-item:has-text("删除好友")').click()
    await pageA.waitForTimeout(800)

    const confirmOpen = await pageA.locator('.modal:has-text("删除好友")').count()
    check('弹出了删除确认框', confirmOpen > 0, `count=${confirmOpen}`)

    // 取消 —— 好友不该被删
    await pageA.locator('.modal button:has-text("取消")').click()
    await pageA.waitForTimeout(1200)
    const stillThere = await pageA.evaluate(async (id) => {
      const t = localStorage.getItem('chatroom.access_token')
      const r = await fetch('/api/friend/list?page_size=100', {
        headers: { Authorization: `Bearer ${t}` },
      })
      const d = await r.json()
      return (d.friends || []).some((f) => f.friend_id === id)
    }, uidB)
    check('点「取消」好友还在', stillThere === true, String(stillThere))

    // 真的确认 —— 好友被删
    await pageA.locator('.friend-item .friend-menu-trigger').first().click()
    await pageA.waitForTimeout(500)
    await pageA.locator('.friend-menu-item:has-text("删除好友")').click()
    await pageA.waitForTimeout(800)
    await pageA.locator('.modal button:has-text("删除")').last().click()
    await pageA.waitForTimeout(1800)

    const gone = await pageA.evaluate(async (id) => {
      const t = localStorage.getItem('chatroom.access_token')
      const r = await fetch('/api/friend/list?page_size=100', {
        headers: { Authorization: `Bearer ${t}` },
      })
      const d = await r.json()
      return (d.friends || []).some((f) => f.friend_id === id)
    }, uidB)
    check('确认后好友被删掉了', gone === false, String(gone))

    // --- 7. 申请列表还是「同意 / 拒绝」按钮 ---
    console.log('\n=== 7. 申请列表保持按钮 ===')
    await pageA.evaluate(async (target) => {
      const t = localStorage.getItem('chatroom.access_token')
      await fetch('/api/friend/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ target_id: target }),
      })
    }, uidB)

    await pageB.reload({ waitUntil: 'domcontentloaded' })
    await pageB.waitForTimeout(1500)
    await pageB.locator('.nav-btn[title="好友"]').click()
    await pageB.waitForTimeout(1500)
    await pageB.locator('.tab:has-text("申请")').click()
    await pageB.waitForTimeout(1200)

    const acceptBtn = await pageB.locator('.friend-item button:has-text("同意")').count()
    const rejectBtn = await pageB.locator('.friend-item button:has-text("拒绝")').count()
    check('申请列表有「同意」按钮', acceptBtn > 0, `count=${acceptBtn}`)
    check('申请列表有「拒绝」按钮', rejectBtn > 0, `count=${rejectBtn}`)

    check('没有 JS 异常', pageErrors.length === 0, pageErrors.join(' | ') || '无')
  } catch (e) {
    console.error('脚本异常：', e)
    failures++
  } finally {
    await browser.close()
  }

  console.log('\n==================================================')
  console.log(`通过 ${results.length - failures} / ${results.length}`)
  process.exit(failures > 0 ? 1 : 0)
})()
