/**
 * 个人资料页的验收脚本。
 *
 * 新的交互设计（微信 / Instagram / LinkedIn 那套）：
 *   1. 大头像 + 相机角标 —— 明说「点这里能换头像」
 *   2. 逐字段就地编辑 —— 点昵称那行变输入框，不用先点「编辑资料」
 *   3. 设置行带 › 导航符，退出登录单独隔一块
 *   4. 手机号邮箱不在下面重复显示一遍
 *
 * 用法：source tests/chromium-env.sh && node tests/profile-page.test.cjs
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

/** 读铅笔图标的实际不透明度 —— 确认它不是 hover 才出现。 */
async function pageA_opacity(page) {
  return page
    .locator('.profile-field .profile-field-edit')
    .first()
    .evaluate((el) => getComputedStyle(el).opacity)
}

/** 造一张 2x2 的 PNG。 */
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
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(2, 0)
  ihdr.writeUInt32BE(2, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.concat([Buffer.from([0]), Buffer.from([255, 0, 0, 255, 0, 0, 255, 255])])
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
  return file
}

;(async () => {
  const browser = await chromium.launch()
  const su = Date.now()
  const pass = 'Passw0rd!123'
  const tmp = path.join('/tmp', `pf-${su}.png`)
  makePng(tmp)
  const pageErrors = []

  try {
    console.log('\n=== 1. 注册并进入资料页 ===')
    const page = await (await browser.newContext()).newPage()
    page.on('pageerror', (e) => pageErrors.push(e.message))
    await uiRegister(page, `pf${su}`, pass)
    await page.locator('.nav-btn[title="我的"]').click()
    await page.waitForTimeout(1500)

    // --- 2. 头图区 ---
    console.log('\n=== 2. 头图区 ===')
    const heroCount = await page.locator('.profile-hero').count()
    check('有头图区', heroCount === 1, `count=${heroCount}`)
    const badgeCount = await page.locator('.avatar-badge').count()
    check('头像上有相机角标', badgeCount === 1, `count=${badgeCount}`)
    const fileInput = await page.locator('.profile-hero ~ input[type="file"], input[type="file"]').count()
    check('有头像上传的 file input', fileInput > 0, `count=${fileInput}`)

    // --- 3. 没有「编辑资料」模式开关 ---
    console.log('\n=== 3. 没有「编辑资料」模式开关 ===')
    const editBtn = await page.locator('button:has-text("编辑资料")').count()
    check('没有「编辑资料」按钮', editBtn === 0, `count=${editBtn}`)
    const oldActions = await page.locator('.profile-actions').count()
    check('没有旧的 .profile-actions 区块', oldActions === 0, `count=${oldActions}`)

    // --- 4. 「个人资料」区不再有昵称行 ---
    console.log('\n=== 4. 「个人资料」区不再重复摆昵称 ===')
    const fieldCount = await page.locator('.profile-field').count()
    check('资料分成了几行', fieldCount === 2, `count=${fieldCount}`)

    const nickRow = await page.locator('.profile-field:has-text("昵称")').count()
    check('「个人资料」区没有昵称行了', nickRow === 0, `count=${nickRow}`)

    const nickRowBtn = await page.locator('.profile-field:has-text("昵称") .profile-field-value').count()
    check('「个人资料」区没有昵称编辑入口', nickRowBtn === 0, `count=${nickRowBtn}`)

    // 每一行都有常驻的铅笔 —— 明说「这行能改」
    const pencilCount = await page.locator('.profile-field .profile-field-edit').count()
    check('每行都有铅笔图标', pencilCount === fieldCount, `${pencilCount}/${fieldCount}`)
    const pencilOpacity = await pageA_opacity(page)
    check('铅笔不是 hover 才出现', pencilOpacity > 0.9, `opacity=${pencilOpacity}`)

    // 手机号那行照样能就地编辑
    await page.locator('.profile-field:has-text("手机号") .profile-field-value').click()
    await page.waitForTimeout(500)
    const phoneInput = await page.locator('.profile-field.is-editing .profile-field-input').count()
    check('点手机号旁边的值就变输入框', phoneInput === 1, `count=${phoneInput}`)
    await page.locator('.profile-field-btn:has-text("取消")').click()
    await page.waitForTimeout(500)

    // --- 4b. 头像旁边的昵称是唯一的昵称入口 ---
    console.log('\n=== 4b. 头像旁边的昵称直接能改 ===')
    const heroNick = await page.locator('.profile-hero .profile-nickname').count()
    check('头像旁边有昵称', heroNick === 1, `count=${heroNick}`)
    const heroEditable = await page.locator('.profile-hero .profile-nickname.is-editable').count()
    check('头像旁边的昵称可点', heroEditable === 1, `count=${heroEditable}`)

    // 页面上只有这一个昵称编辑入口
    const nickEntryTotal = await page.locator('.profile-nickname.is-editable').count()
    check('页面上只有一个昵称编辑入口', nickEntryTotal === 1, `count=${nickEntryTotal}`)

    await page.locator('.profile-hero .profile-nickname.is-editable').click()
    await page.waitForTimeout(600)
    const heroInput = await page.locator('.profile-nickname-input').count()
    check('点昵称就变输入框', heroInput === 1, `count=${heroInput}`)

    await page.locator('.profile-nickname-input').fill('头图改的昵称')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1800)

    const heroName = await page.locator('.profile-hero .profile-nickname').textContent()
    check('头图昵称已更新', heroName === '头图改的昵称', heroName || '(无)')
    const backendName2 = await page.evaluate(async () => {
      const t = localStorage.getItem('chatroom.access_token')
      const d = await (await fetch('/api/user/info', {
        headers: { Authorization: `Bearer ${t}` },
      })).json()
      return d.nickname
    })
    check('后端存的也是新昵称', backendName2 === '头图改的昵称', backendName2)

    // --- 5. Escape 取消 ---
    console.log('\n=== 5. Escape 取消编辑 ===')
    await page.locator('.profile-field:has-text("手机号") .profile-field-value').click()
    await page.waitForTimeout(400)
    await page.locator('.profile-field.is-editing .profile-field-input').fill('13800000000')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
    const editingLeft = await page.locator('.profile-field.is-editing').count()
    check('Escape 退出编辑态', editingLeft === 0, `count=${editingLeft}`)
    const phoneValue = await page
      .locator('.profile-field:has-text("手机号") .profile-field-value')
      .textContent()
      .catch(() => null)
    check('手机号没被改（Escape 放弃了）', phoneValue !== '13800000000', phoneValue || '(空)')

    // --- 6. 取消按钮 ---
    console.log('\n=== 6. 「取消」按钮也放弃编辑 ===')
    await page.locator('.profile-field:has-text("邮箱") .profile-field-value').click()
    await page.waitForTimeout(400)
    await page.locator('.profile-field.is-editing .profile-field-input').fill('a@b.com')
    await page.locator('.profile-field-btn:has-text("取消")').click()
    await page.waitForTimeout(700)
    const editingLeft2 = await page.locator('.profile-field.is-editing').count()
    check('点「取消」退出编辑态', editingLeft2 === 0, `count=${editingLeft2}`)

    // --- 7. 设置区 ---
    console.log('\n=== 7. 设置区 ===')
    const settings = await page.locator('.profile-setting').count()
    check('有设置行', settings >= 2, `count=${settings}`)
    const pwdRow = await page.locator('.profile-setting:has-text("修改密码")').count()
    check('有「修改密码」行', pwdRow === 1, `count=${pwdRow}`)
    const chevron = await page.locator('.profile-setting-chevron').count()
    check('导航行带 › 箭头', chevron > 0, `count=${chevron}`)
    const logoutRow = await page.locator('.profile-setting.is-danger:has-text("退出登录")').count()
    check('退出登录是独立的一块且标红', logoutRow === 1, `count=${logoutRow}`)

    // 退出登录是危险色
    const logoutColor = await page
      .locator('.profile-setting.is-danger')
      .evaluate((el) => getComputedStyle(el).color)
    check('退出登录用的是危险色', logoutColor.includes('220') || logoutColor.includes('241'), logoutColor)

    // --- 8. 不重复显示 ---
    console.log('\n=== 8. 手机号邮箱不重复显示 ===')
    const oldRows = await page.locator('.profile-row').count()
    check('没有旧的 .profile-row 展示区', oldRows === 0, `count=${oldRows}`)

    // --- 9. 改密码弹窗 ---
    console.log('\n=== 9. 修改密码弹窗 ===')
    await page.locator('.profile-setting:has-text("修改密码")').click()
    await page.waitForTimeout(700)
    const pwdModal = await page.locator('.modal:has-text("修改密码")').count()
    check('修改密码弹窗打开了', pwdModal > 0, `count=${pwdModal}`)
    await page.locator('.modal button:has-text("取消")').click()
    await page.waitForTimeout(500)

    check('没有 JS 异常', pageErrors.length === 0, pageErrors.join(' | ') || '无')
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
