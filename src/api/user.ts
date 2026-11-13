/** 用户服务接口 —— 端口 8000。 */
import { get, post, put, setTokens, clearTokens } from './client'

/** 用户资料。email/phone 只有看自己时才有值。 */
export interface UserInfo {
  id: string
  username: string
  nickname: string
  avatar: string
  created_at: number
  email?: string
  phone?: string
}

/** 登录 / 刷新返回的 token 对。 */
export interface LoginReply {
  token: string
  user_id: string
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

/** 注册。username 必填，nickname 留空回退 username。 */
export function register(username: string, password: string, nickname?: string) {
  return post<{ id: string }>('user', '/register', {
    username,
    password,
    // 后端也会做这个回退，这里先兜一层 —— 少一个字段语义依赖。
    nickname: nickname?.trim() || username,
  })
}

/** 登录。成功后双 token 落 localStorage。 */
export async function login(username: string, password: string): Promise<LoginReply> {
  const reply = await post<LoginReply>('user', '/login', { username, password })
  if (reply?.access_token) {
    setTokens(reply.access_token, reply.refresh_token)
  }
  return reply
}

/** 登出：access 进黑名单 + refresh 删除。 */
export async function logout(refreshToken: string): Promise<void> {
  try {
    await post('user', '/logout', { refresh_token: refreshToken })
  } finally {
    clearTokens()
  }
}

/** 当前用户资料。 */
export function getCurrentUser(): Promise<UserInfo> {
  return get<UserInfo>('user', '/info')
}

/**
 * 改当前用户资料。
 *
 * update_mask 是 google.protobuf.FieldMask，JSON 形态是 {"paths":[...]}，
 * 不是裸数组 —— 传数组后端会报 CODEC。
 * 不列的字段保持原值。
 */
export function updateCurrentUser(input: {
  nickname?: string
  avatar?: string
  update_mask?: string[]
}): Promise<UserInfo> {
  return put<UserInfo>('user', '/info', {
    nickname: input.nickname ?? '',
    avatar: input.avatar ?? '',
    update_mask: { paths: input.update_mask ?? [] },
  })
}

/** 改密。改完会强制登出当前会话。 */
export function changePassword(oldPassword: string, newPassword: string, refreshToken: string) {
  return post('user', '/change_password', {
    old_password: oldPassword,
    new_password: newPassword,
    refresh_token: refreshToken,
  })
}

/** 批量查公开资料，避免 N+1。不可见 / 不存在的 id 静默剔除。 */
export function getUsersByIds(ids: string[]): Promise<{ users: UserInfo[] }> {
  return post<{ users: UserInfo[] }>('user', '/batch', { ids })
}
