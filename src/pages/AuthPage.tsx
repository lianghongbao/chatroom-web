/** 登录 / 注册页。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../stores/auth'
import { toast } from '../utils/toast'
import { errorMessage } from '../utils/errors'
import { checkUsernameAvailable, normalizeAvailable } from '../api/user'

/** 用户名校验状态。idle = 没查过；checking = 在查；ok / taken = 结论。 */
type UsernameState = 'idle' | 'checking' | 'ok' | 'taken'

/** 输入停多久后发起校验（毫秒）。 */
const CHECK_DEBOUNCE_MS = 500

/** 少于这个长度不查占用 —— 单个字符几乎必然可用，查了也是白查。 */
const CHECK_MIN_LENGTH = 2

/** 用户名 / 昵称 / 密码的长度上限，跟后端 biz 层的常量对齐。 */
const MAX_USERNAME_LENGTH = 36
const MAX_NICKNAME_LENGTH = 64
const MIN_PASSWORD_LENGTH = 6

/** 手机号长度（中国大陆 11 位）。 */
const PHONE_LENGTH = 11

/**
 * 校验注册表单。返回第一条错误信息，全对返 null。
 *
 * 跟后端 biz 层的 validateUsername / validatePassword / validatePhone 对齐 ——
 * 前端先拦一道是为了即时反馈，后端那道才是权威（前端能改）。
 *
 * 只在注册模式校验：登录时密码规则由后端判定（老账号可能用老规则注册的）。
 */
function validateRegister(
  username: string,
  password: string,
  confirmPassword: string,
  nickname: string,
  phone: string,
): string | null {
  const name = username.trim()
  if (!name) return '请填写用户名'
  if (name.length < 2) return '用户名至少 2 个字符'
  if (name.length > MAX_USERNAME_LENGTH) return `用户名最多 ${MAX_USERNAME_LENGTH} 个字符`
  if (!password) return '请填写密码'
  if (password.length < MIN_PASSWORD_LENGTH) return `密码至少 ${MIN_PASSWORD_LENGTH} 个字符`
  if (password !== confirmPassword) return '两次输入的密码不一致'
  if (nickname.trim().length > MAX_NICKNAME_LENGTH) {
    return `昵称最多 ${MAX_NICKNAME_LENGTH} 个字符`
  }
  // 手机号留空 = 不填，非空必须是 11 位。后端只查长度不查格式，
  // 但前端拦一道纯数字能挡掉大部分手滑。
  const p = phone.trim()
  if (p && !/^\d{11}$/.test(p)) return '手机号是 11 位数字'
  return null
}

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [nameState, setNameState] = useState<UsernameState>('idle')
  // 各字段的即时错误。key 是字段名，值是错误文案。
  // 只在 blur 或提交后出现 —— 边打字边报错太吵。
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const clearError = useAuthStore((s) => s.clearError)

  // 防抖定时器。存进 ref 是因为 onChange 闭包里不能读到「最新的」定时器 id。
  const timerRef = useRef<number | null>(null)
  // 请求序号。每次发请求记一个号，回来时只认当前号 ——
  // 否则连续输入时后发的响应可能先到，早到的旧响应会覆盖新结论。
  const seqRef = useRef(0)

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    clearError()
    // 登录页不校验用户名，切过去时把结论清掉，免得登录页上显示「用户名已被占用」。
    setNameState('idle')
    // 确认密码只在注册模式有 —— 切走时清掉，切回来时是空的。
    setConfirmPassword('')
    // 校验错误也是注册模式专属的。
    setFieldErrors({})
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  // 卸载时清掉未触发的定时器，别让 setState 打在卸载后的组件上。
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  /**
   * 查用户名是否被占用。
   *
   * 只认最后一次请求的结果 —— seqRef 记号，回来时号对不上就丢掉。
   */
  const runCheck = useCallback(async (name: string) => {
    const trimmed = name.trim()
    // 太短不查 —— 单个字符几乎必然没人用，查了是白费一次请求。
    if (trimmed.length < CHECK_MIN_LENGTH) {
      setNameState('idle')
      return
    }
    const seq = ++seqRef.current
    setNameState('checking')
    try {
      const reply = await checkUsernameAvailable(trimmed)
      if (seq !== seqRef.current) return // 已经有更新的请求了，丢掉这个结果
      setNameState(normalizeAvailable(reply) ? 'ok' : 'taken')
    } catch (err) {
      if (seq !== seqRef.current) return
      setNameState('idle')
      // 校验失败**不弹 toast**：限频（USER_RATE_LIMITED）之类的问题不该打扰用户，
      // 真正提交时后端会再拦一次，那次才值得提示。
      void err
    }
  }, [])

  /** 输入时防抖校验。 */
  const scheduleCheck = useCallback(
    (name: string) => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        void runCheck(name)
      }, CHECK_DEBOUNCE_MS)
    },
    [runCheck],
  )

  const handleUsernameChange = (v: string) => {
    setUsername(v)
    // 改了内容，上一次的结论就作废了 —— 免得拿旧结论提示新名字。
    setNameState('idle')
    // 长度错误当场清掉 —— 用户正在改，再挂着旧错误是干扰。
    setFieldErrors((prev) => (prev.username ? { ...prev, username: '' } : prev))
    if (mode === 'register') scheduleCheck(v)
  }

  /** 失焦时立即查一次，并取消还没触发的防抖 —— 免得查两遍。 */
  const handleUsernameBlur = () => {
    if (mode !== 'register') return
    // 长度不对就别查了 —— 查了也是白查（后端会拒）。
    const name = username.trim()
    if (name.length < 2) {
      setFieldErrors((prev) => ({ ...prev, username: '用户名至少 2 个字符' }))
      return
    }
    setFieldErrors((prev) => ({ ...prev, username: '' }))
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    void runCheck(username)
  }

  /**
   * 失焦时校验单个字段。
   *
   * field 是字段名，value 是该字段的值，check 是这条规则的具体判据。
   * 判据不过就记一条错误，通过就清掉 —— 让错误跟着输入实时消失。
   */
  const validateField = (field: string, value: string, check: (v: string) => string | null) => {
    const msg = check(value)
    setFieldErrors((prev) => ({ ...prev, [field]: msg ?? '' }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'register') {
      // 前端先校验一轮 —— 逐条给出具体哪里不对，比后端返一个笼统的
      // USER_INVALID_ARGUMENT 好用。后端那道仍然照常跑，是权威。
      const msg = validateRegister(username, password, confirmPassword, nickname, phone)
      if (msg) {
        toast(msg, 'error')
        return
      }
      if (nameState === 'taken') {
        toast('这个用户名已被占用，换一个吧', 'error')
        return
      }
    } else if (!username.trim() || !password) {
      toast('请填写用户名和密码', 'error')
      return
    }
    try {
      if (mode === 'login') {
        await login(username.trim(), password)
      } else {
        await register(username.trim(), password, nickname.trim() || undefined, phone.trim() || undefined, email.trim() || undefined)
      }
    } catch (err) {
      toast(errorMessage(err, mode === 'login' ? '登录失败' : '注册失败'), 'error')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className="auth-title">Chatroom</h1>
          <p className="auth-subtitle">登录后开始聊天</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-head">
              <span className="field-label">用户名<span className="field-required">*</span></span>
              {mode === 'register' && !fieldErrors.username && nameState === 'idle' && (
                <span className="field-note">2–{MAX_USERNAME_LENGTH} 个字符</span>
              )}
            </span>
            <input
              type="text"
              value={username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              onBlur={handleUsernameBlur}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
              maxLength={MAX_USERNAME_LENGTH}
              // 输入框本身也标红 —— 只在下面写一行红字不够醒目。
              className={
                mode === 'register' && (nameState === 'taken' || fieldErrors.username)
                  ? 'is-invalid'
                  : undefined
              }
            />
            {mode === 'register' &&
              (fieldErrors.username ? (
                <span className="field-hint field-hint-taken">{fieldErrors.username}</span>
              ) : nameState !== 'idle' ? (
                <span className={`field-hint field-hint-${nameState}`}>
                  {nameState === 'checking' && '检查中…'}
                  {nameState === 'ok' && '用户名可用'}
                  {nameState === 'taken' && '该用户名已被占用'}
                </span>
              ) : null)}
          </label>

          {mode === 'register' && (
            <>
              <label className="field">
                <span className="field-head">
                  <span className="field-label">昵称</span>
                  <span className="field-note">最多 {MAX_NICKNAME_LENGTH} 个字符</span>
                </span>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="留空则使用用户名"
                  maxLength={MAX_NICKNAME_LENGTH}
                />
              </label>
              <label className="field">
                <span className="field-head">
                  <span className="field-label">手机号</span>
                  <span className="field-note">11 位数字</span>
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    setFieldErrors((prev) => (prev.phone ? { ...prev, phone: '' } : prev))
                  }}
                  onBlur={() =>
                    validateField('phone', phone, (v) => {
                      const t = v.trim()
                      if (!t) return null // 留空 = 不填
                      return /^\d{11}$/.test(t) ? null : '手机号是 11 位数字'
                    })
                  }
                  placeholder="11 位手机号"
                  maxLength={PHONE_LENGTH}
                  inputMode="numeric"
                  className={fieldErrors.phone ? 'is-invalid' : undefined}
                />
                {fieldErrors.phone && (
                  <span className="field-hint field-hint-taken">{fieldErrors.phone}</span>
                )}
              </label>
              <label className="field">
                <span className="field-label">邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alice@example.com"
                />
              </label>
            </>
          )}

          <label className="field">
            <span className="field-head">
              <span className="field-label">密码<span className="field-required">*</span></span>
              {mode === 'register' && !fieldErrors.password && (
                <span className="field-note">至少 {MIN_PASSWORD_LENGTH} 个字符</span>
              )}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setFieldErrors((prev) => (prev.password ? { ...prev, password: '' } : prev))
              }}
              onBlur={() => {
                if (mode !== 'register') return
                validateField('password', password, (v) =>
                  v && v.length < MIN_PASSWORD_LENGTH ? `密码至少 ${MIN_PASSWORD_LENGTH} 个字符` : null,
                )
              }}
              placeholder="请输入密码"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className={mode === 'register' && fieldErrors.password ? 'is-invalid' : undefined}
            />
            {mode === 'register' && fieldErrors.password && (
              <span className="field-hint field-hint-taken">{fieldErrors.password}</span>
            )}
          </label>

          {mode === 'register' && (
            <label className="field">
              <span className="field-head">
                <span className="field-label">确认密码<span className="field-required">*</span></span>
                {confirmPassword && confirmPassword !== password && (
                  <span className="field-hint field-hint-taken">两次输入的密码不一致</span>
                )}
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再输入一次密码"
                autoComplete="new-password"
                className={
                  confirmPassword && confirmPassword !== password ? 'is-invalid' : undefined
                }
              />
            </label>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'login' ? (
            <>
              还没有账号？
              <button onClick={() => switchMode('register')}>立即注册</button>
            </>
          ) : (
            <>
              已有账号？
              <button onClick={() => switchMode('login')}>去登录</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
