/** 把后端错误翻译成给用户看的中文提示。 */
import { ApiError } from '../api/client'

/**
 * 后端 reason → 中文提示。命中的走定制文案，其余用通用文案。
 *
 * reason 必须跟后端**实际发出的字符串**一致。后端分两处定义：
 *   - 框架级：chatroom/pkg/errors/errors.go 的 reasonName 表（COMMON_* 前缀）
 *   - 域级：api/<域>/service/v1/error_reason.proto 的枚举名
 * 写错一个字母就永远命中不了 —— 用户看到的是后端的英文原文。
 */
const REASON_MESSAGES: Record<string, string> = {
  // 框架级（pkg/errors + pkg/middleware）
  COMMON_UNAUTHENTICATED: '登录状态已失效，请重新登录',
  COMMON_PERMISSION_DENIED: '没有权限执行此操作',
  COMMON_INTERNAL_TOKEN_INVALID: '服务内部调用凭证无效',
  COMMON_UPSTREAM_UNAVAILABLE: '依赖服务暂时不可用，请稍后重试',
  COMMON_RATE_LIMITED: '操作太频繁，请稍后再试',
  COMMON_INVALID_ARGUMENT: '参数不合法',
  COMMON_TIMEOUT: '请求超时，请稍后重试',
  INVALID_TOKEN: '登录凭证无效，请重新登录',

  // user 域
  USER_NOT_FOUND: '用户不存在',
  USER_INVALID_ARGUMENT: '参数不合法',
  USER_ALREADY_EXISTS: '用户名已被占用',
  USER_BAD_CREDENTIALS: '用户名或密码错误',
  USER_LOGIN_LOCKED: '登录失败次数过多，账号已临时锁定',
  USER_REFRESH_INVALID: '登录凭证已失效，请重新登录',
  USER_TOKEN_BLACKLISTED: '登录凭证已失效，请重新登录',
  USER_INVALID_OLD_PASSWORD: '原密码不正确',
  USER_BANNED: '账号已被封禁',

  // friend 域
  FRIEND_NOT_FOUND: '好友申请不存在',
  FRIEND_INVALID_ARGUMENT: '好友请求参数不合法',
  FRIEND_ALREADY_FRIENDS: '已经是好友了',
  FRIEND_ALREADY_APPLIED: '已经申请过了，等对方通过吧',
  FRIEND_PENDING_NOT_FOUND: '好友申请不存在或已处理',
  FRIEND_NOT_RECIPIENT: '只有申请人能处理这条申请',
  FRIEND_SELF: '不能添加自己为好友',
  FRIEND_RATE_LIMITED: '好友申请太频繁，请稍后再试',

  // conversation 域
  CONVERSATION_NOT_FOUND: '会话不存在',
  CONVERSATION_INVALID_ARGUMENT: '会话参数不合法',
  CONVERSATION_NOT_MEMBER: '你不是该会话成员',
  CONVERSATION_ALREADY_MEMBER: '该成员已在会话中',
  CONVERSATION_OWNER_CANNOT_LEAVE: '群主不能直接退群，请先转让群主',
  CONVERSATION_NOT_OWNER: '只有群主才能执行此操作',
  CONVERSATION_MEMBER_LIMIT: '成员数量已达上限',
  CONVERSATION_EMPTY: '会话里没有别的成员了',
  CONVERSATION_NOT_GROUP: '只有群聊支持此操作',
  CONVERSATION_USER_NOT_FOUND: '指定的成员不存在',
  CONVERSATION_UNREAD_CONFLICT: '未读数更新冲突，请重试',

  // message 域
  MESSAGE_INVALID_ARGUMENT: '消息参数不合法',
  MESSAGE_NOT_FOUND: '消息不存在',
  MESSAGE_NOT_MEMBER: '你不是该会话成员',
  MESSAGE_CONTENT_TOO_LONG: '消息内容太长',
  MESSAGE_CONVERSATION_UNAVAILABLE: '会话已解散，无法发送消息',
}

/**
 * 把任意异常转成可展示的文案。
 *
 * 后端的 reason 是业务错误码，比 message 更稳定 —— message 可能被后端改文案，
 * reason 不会。所以优先用 reason 映射。
 */
export function errorMessage(err: unknown, fallback = '操作失败'): string {
  if (err instanceof ApiError) {
    return REASON_MESSAGES[err.reason] ?? err.message ?? fallback
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}
