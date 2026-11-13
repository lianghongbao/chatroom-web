/** 时间格式化工具。 */

/**
 * 会话列表里的时间摘要。timestamp 是秒级 Unix 时间戳。
 *
 * 今天显示时分，昨天显示「昨天」，更早显示日期。
 */
export function formatConversationTime(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const now = new Date()

  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isSameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  if (isYesterday) return '昨天'

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  }
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

/**
 * 消息气泡旁的时间。
 *
 * 同一分钟内只显示第一条，其余省略 —— 连续消息不用每条都带时间。
 */
export function formatMessageTime(timestamp: number): string {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 消息区里的日期分隔条。timestamp 是秒级 Unix 时间戳。 */
export function formatDateSeparator(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isSameDay) return '今天'

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  if (isYesterday) return '昨天'

  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** 判断两个时间戳是否隔了超过 5 分钟 —— 超过就要显示日期分隔条。prev 为 0 表示没有上一条。 */
export function isNewTimeGroup(prev: number, current: number): boolean {
  if (!prev) return true
  return current - prev > 5 * 60
}
