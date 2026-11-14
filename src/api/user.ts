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

/**
 * 注册。username 必填，nickname 留空回退 username。
 *
 * phone 可选，填了就全局唯一 —— 被别人占用时后端返 409 USER_PHONE_TAKEN。
 *
 * email 可选，不唯一、不校验格式 —— 目前只是个备注字段。
 */
export function register(
  username: string,
  password: string,
  nickname?: string,
  phone?: string,
  email?: string,
) {
  return post<{ id: string }>('user', '/register', {
    username,
    password,
    // 后端也会做这个回退，这里先兜一层 —— 少一个字段语义依赖。
    nickname: nickname?.trim() || username,
    phone: phone?.trim() || '',
    email: email?.trim() || '',
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

/** 登出：access 进黑名单 + refresh 删除。无论后端成败都会清本地 token。 */
export async function logout(refreshToken: string): Promise<void> {
  try {
    await post('user', '/logout', { refresh_token: refreshToken })
  } finally {
    clearTokens()
  }
}

/** 查当前登录用户的资料。 */
export function getCurrentUser(): Promise<UserInfo> {
  return get<UserInfo>('user', '/info')
}

/**
 * 改当前用户资料。
 *
 * update_mask 是 google.protobuf.FieldMask，JSON 形态是 {"paths":[...]}，
 * 不是裸数组 —— 传数组后端会报 CODEC。
 * 不列的字段保持原值。
 *
 * phone / email 特殊：空串表示「清空」，跟 nickname / avatar 不同 ——
 * 那两个传空串会被后端判为非法。
 */
export function updateCurrentUser(input: {
  nickname?: string
  avatar?: string
  phone?: string
  email?: string
  update_mask?: string[]
}): Promise<UserInfo> {
  return put<UserInfo>('user', '/info', {
    nickname: input.nickname ?? '',
    avatar: input.avatar ?? '',
    phone: input.phone ?? '',
    email: input.email ?? '',
    update_mask: { paths: input.update_mask ?? [] },
  })
}

/**
 * 改密。改完会强制登出当前会话。
 *
 * oldPassword 是原密码，newPassword 是新密码，refreshToken 用来作废旧会话。
 */
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

/**
 * 按用户名精确查公开资料。
 *
 * uid 是 UUIDv7 字符串，用户记不住 —— 加好友时用用户名找人。
 * 不做「对陌生人可见」判定：好友申请本来就允许陌生人互相发起，
 * 对方关了可见性就查不到人的话，加好友这条路直接堵死。
 * 返回的资料不含 email / phone。
 *
 * 查无此人时后端返 404，reason = USER_NOT_FOUND。
 */
export function getUserByUsername(username: string): Promise<UserInfo> {
  return get<UserInfo>('user', '/lookup/username', { username })
}

/**
 * 按手机号精确查公开资料。
 *
 * 手机号全局唯一，所以最多一个结果。
 * 不做「对陌生人可见」判定 —— 好友申请本来就允许陌生人互相发起，
 * 对方关了可见性就查不到人的话，加好友这条路直接堵死。
 * 返回的资料不含 email / phone。
 *
 * 查无此人时后端返 404，reason = USER_NOT_FOUND。
 */
export function getUserByPhone(phone: string): Promise<UserInfo> {
  return get<UserInfo>('user', '/lookup/phone', { phone })
}

/**
 * 查找用户 —— 一个输入框同时支持用户名和手机号。
 *
 * 全是数字且 11 位 → 按手机号查，否则按用户名查。
 * 用户不用管自己填的是哪种。
 */
export function findUser(input: string): Promise<UserInfo> {
  const q = input.trim()
  return isPhone(q) ? getUserByPhone(q) : getUserByUsername(q)
}

/** 判断一个字符串是不是手机号 —— 全数字且 11 位。 */
export function isPhone(input: string): boolean {
  return /^\d{11}$/.test(input.trim())
}
