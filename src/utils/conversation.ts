/**
 * 会话展示相关的纯函数。
 *
 * 单独成文件而不是放在组件里 —— 组件文件只导出组件时，React Fast Refresh 才能正常工作。
 */
import type { ConversationInfo } from '../api/conversation'
import { ConversationType } from '../api/conversation'

/**
 * 会话的展示名。
 *
 * 单聊后端不返回 name（proto 里明说「单聊为空」），要用**对方**昵称兜底；
 * 群聊直接用群名。
 */
export function conversationTitle(
  conversation: ConversationInfo,
  selfId: string,
): string {
  if (conversation.type === ConversationType.Group) {
    return conversation.name || '未命名群聊'
  }
  // 单聊：取「不是我」的那个成员 —— 取成自己的昵称就成了自说自话。
  const index = conversation.member_ids.findIndex((id) => id !== selfId)
  const nickname = index >= 0 ? conversation.member_nicknames[index] : ''
  return nickname || '未命名会话'
}

/** 单聊时对方的头像。群聊没有单一头像。 */
export function conversationAvatar(
  conversation: ConversationInfo,
  selfId: string,
): string {
  if (conversation.type === ConversationType.Group) return ''
  const index = conversation.member_ids.findIndex((id) => id !== selfId)
  const avatar = index >= 0 ? conversation.member_avatars[index] : ''
  return avatar || ''
}

/** 列表项里的最后一条消息摘要。 */
export function lastMessagePreview(conversation: ConversationInfo): string {
  if (conversation.last_message) return conversation.last_message
  if (conversation.type === ConversationType.Group) {
    return `${conversation.member_count} 人`
  }
  return '还没有消息'
}
