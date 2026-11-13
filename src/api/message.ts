/** 消息服务接口 —— 端口 8003。 */
import { get, post } from './client'

/** 消息类型。用 const 对象代替 enum —— tsconfig 开了 erasableSyntaxOnly。 */
export const MessageType = {
  Unspecified: 0,
  Text: 1,
  Image: 2,
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
 * 调用方必须是会话成员（后端判定）。落库成功后才广播，
 * 所以「收到推送」等价于「已经存下来了」。
 */
export function sendMessage(conversationId: number, content: string, type = MessageType.Text) {
  return post<{ message: MessageInfo }>('message', '/send', {
    conversation_id: conversationId,
    type,
    content,
  })
}

/**
 * 拉历史消息。
 *
 * 游标分页：cursor 是「比这个 id 更旧的」，按 id 倒序返回（新的在前）。
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
