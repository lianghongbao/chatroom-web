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

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [nameState, setNameState] = useState<UsernameState>('idle')
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
    if (!trimmed) {
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
    if (mode === 'register') scheduleCheck(v)
  }

  /** 失焦时立即查一次，并取消还没触发的防抖 —— 免得查两遍。 */
  const handleUsernameBlur = () => {
    if (mode !== 'register') return
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    void runCheck(username)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      toast('请填写用户名和密码', 'error')
      return
    }
    if (mode === 'register' && nameState === 'taken') {
      toast('这个用户名已被占用，换一个吧', 'error')
      return
    }
    if (mode === 'register' && !confirmPassword) {
      toast('请再次输入密码', 'error')
      return
    }
    if (mode === 'register' && password !== confirmPassword) {
      toast('两次输入的密码不一致', 'error')
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
            <span className="field-label">用户名<span className="field-required">*</span></span>
            <input
              type="text"
              value={username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              onBlur={handleUsernameBlur}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
            />
            {mode === 'register' && nameState !== 'idle' && (
              <span className={`field-hint field-hint-${nameState}`}>
                {nameState === 'checking' && '检查中…'}
                {nameState === 'ok' && '用户名可用'}
                {nameState === 'taken' && '该用户名已被占用'}
              </span>
            )}
          </label>

          {mode === 'register' && (
            <>
              <label className="field">
                <span className="field-label">昵称</span>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="留空则使用用户名"
                />
              </label>
              <label className="field">
                <span className="field-label">手机号</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="11 位手机号，用于添加好友"
                  maxLength={11}
                  inputMode="numeric"
                />
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
            <span className="field-label">密码<span className="field-required">*</span></span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {mode === 'register' && (
            <label className="field">
              <span className="field-label">确认密码<span className="field-required">*</span></span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再输入一次密码"
                autoComplete="new-password"
              />
              {confirmPassword && confirmPassword !== password && (
                <span className="field-hint field-hint-taken">两次输入的密码不一致</span>
              )}
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
