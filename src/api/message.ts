/** 消息服务接口 —— 端口 8003。 */
import { get, post } from './client'

/**
 * 消息类型。用 const 对象代替 enum —— tsconfig 开了 erasableSyntaxOnly。
 * 枚举要传数字，传字符串后端会 unmarshal 失败。
 */
export const MessageType = {
  Unspecified: 0,
  Text: 1,
  Image: 2,
  Emoji: 3,
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

/** 一条消息。 */
export interface MessageInfo {
  id: number
  conversation_id: number
  sender_id: string
  type: MessageType
  content: string
  created_at: number
}

/**
 * 发消息。
 *
 * conversationId 是会话 id，content 是正文，type 是消息类型。
 * 调用方必须是会话成员（后端判定）。落库成功后才广播，
 * 所以「收到推送」等价于「已经存下来了」。
 */
export function sendMessage(conversationId: number, content: string, type: MessageType = MessageType.Text) {
  return post<{ message: MessageInfo }>('message', '/send', {
    conversation_id: conversationId,
    type,
    content,
  })
}

/**
 * 拉历史消息。
 *
 * 游标分页：cursor 是「比这个 id 更旧的」，按 id 倒序返回（新的在前）；
 * 首次留空 = 从最新一条开始拉。
 */
export function listMessages(conversationId: number, cursor?: number, pageSize = 30) {
  return get<{ messages: MessageInfo[]; next_cursor: number }>('message', '/list', {
    conversation_id: conversationId,
    cursor: cursor || undefined,
    page_size: pageSize,
  })
}

/** 清零会话未读数。只清调用方自己的。 */
export function markRead(conversationId: number): Promise<{ unread_count: number }> {
  return post<{ unread_count: number }>('message', '/read', {
    conversation_id: conversationId,
  })
}

/**
 * 查未读数。
 *
 * 不传 conversation_id 时返回所有会话的未读总数（角标用），
 * per_conversation 里是各会话的未读数。
 */
export function getUnreadCount(conversationId?: number) {
  return get<{ unread_count: number; per_conversation: Record<string, number> }>(
    'message',
    '/unread',
    { conversation_id: conversationId || undefined },
  )
}

/** 聊天图片直传凭证 —— OSS PostObject 表单。 */
export interface ImageUploadToken {
  /** OSS 上传地址，POST 到这里。 */
  host: string
  /** 表单字段，原样塞进 FormData。值不能改，改了签名对不上。 */
  fields: Record<string, string>
  /** 完整 object key。 */
  file_key: string
  /** 上传后可访问的地址 —— 把它塞进 SendMessage 的 content（type=Image）。 */
  public_url: string
  /** 过期时间，Unix 秒。 */
  expire_at: number
  /** 允许的最大字节数，0 表示不限。 */
  max_size: number
}

/**
 * 签发聊天图片直传凭证。
 *
 * ext 是文件后缀，不带点。后缀不在后端白名单内时返 400。
 *
 * 拿到的 public_url 是 SendMessage(type=Image) 的 content ——
 * 后端会校验这个地址是不是本次签发的对象，外链会被拒。
 */
export function getImageUploadToken(ext: string): Promise<ImageUploadToken> {
  return post<ImageUploadToken>('message', '/image/upload_token', { ext })
}
