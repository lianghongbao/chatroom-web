/**
 * 后端 HTTP 客户端。
 *
 * chatroom 的 Kratos v3 走 HTTP 时，JSON 字段名是 snake_case（生成代码的 json tag 用 proto 原名），
 * 响应体是裸的 proto message —— 没有 {code, message, data} 包装层。
 * 错误响应是 Kratos Error：{code, reason, message}，业务错误码看 reason。
 */

/** 带 HTTP 状态码与 reason 的错误。 */
export class ApiError extends Error {
  readonly status: number
  readonly reason: string

  constructor(status: number, reason: string, message: string) {
    super(message || reason)
    this.name = 'ApiError'
    this.status = status
    this.reason = reason
  }
}

/** 五个服务的基地址。开发期走 vite proxy，避免 CORS。 */
const BASES = {
  user: '/api/user',
  friend: '/api/friend',
  conversation: '/api/conversation',
  message: '/api/message',
} as const

export type ServiceName = keyof typeof BASES

const ACCESS_KEY = 'chatroom.access_token'
const REFRESH_KEY = 'chatroom.refresh_token'

/** 从 localStorage 取 access token。 */
export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY)
}

/** 取 refresh token。 */
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

/** 存一对 token。 */
export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}

/** 清掉本地 token。 */
export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

/**
 * 刷新 token 的并发去重。
 *
 * 多个请求同时 401 时，只发一次 refresh，其余等同一个 Promise ——
 * 否则 refresh token 是一次性的（OAuth rotation），并发刷新会让后几次全部失败。
 */
let refreshPromise: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken()
  if (!refresh) return false

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASES.user}/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        })
        if (!res.ok) {
          clearTokens()
          return false
        }
        const data = await res.json()
        if (!data?.access_token) {
          clearTokens()
          return false
        }
        setTokens(data.access_token, data.refresh_token || refresh)
        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

/** 401 时的回调 —— 由 auth store 注册，用来把界面切回登录页。 */
let onUnauthorized: (() => void) | null = null

/** 注册 401 回调。 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
  /** 内部使用：标记这是刷新后重试，避免无限递归。 */
  retry?: boolean
}

/**
 * 发一次请求。
 *
 * 自动带 Bearer token；401 时先尝试刷新再重试一次，仍失败则抛 ApiError。
 */
export async function request<T>(
  service: ServiceName,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, query, retry = false } = options

  let url = `${BASES[service]}${path}`
  if (query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.append(k, String(v))
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401 && !retry) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      return request<T>(service, path, { ...options, retry: true })
    }
    clearTokens()
    onUnauthorized?.()
    throw new ApiError(401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录')
  }

  if (!res.ok) {
    let reason = 'UNKNOWN'
    let message = `请求失败 (${res.status})`
    try {
      // Kratos 的错误结构：{code, reason, message}，业务错误码看 reason
      const err = (await res.json()) as { reason?: string; message?: string }
      if (err.reason) reason = err.reason
      if (err.message) message = err.message
    } catch {
      // 响应体不是 JSON，沿用默认文案
    }
    throw new ApiError(res.status, reason, message)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** GET。 */
export function get<T>(
  service: ServiceName,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  return request<T>(service, path, { method: 'GET', query })
}

/** POST。 */
export function post<T>(
  service: ServiceName,
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(service, path, { method: 'POST', body })
}

/** PUT。 */
export function put<T>(service: ServiceName, path: string, body?: unknown): Promise<T> {
  return request<T>(service, path, { method: 'PUT', body })
}
