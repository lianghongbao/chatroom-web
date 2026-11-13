/** 会话列表侧边栏。 */
import { useMemo, useState } from 'react'
import { Avatar } from './Avatar'
import { useConversationStore } from '../stores/conversation'
import { useAuthStore } from '../stores/auth'
import { usePresenceStore } from '../stores/presence'
import type { ConversationInfo } from '../api/conversation'
import { ConversationType } from '../api/conversation'
import { formatConversationTime } from '../utils/format'
import {
  conversationAvatar,
  conversationTitle,
  lastMessagePreview,
} from '../utils/conversation'

interface ConversationListProps {
  activeId: number | null
  onSelect: (conversation: ConversationInfo) => void
  onNewChat: () => void
}

export function ConversationList({ activeId, onSelect, onNewChat }: ConversationListProps) {
  const conversations = useConversationStore((s) => s.conversations)
  const unread = useConversationStore((s) => s.unread)
  const previews = useConversationStore((s) => s.previews)
  const loading = useConversationStore((s) => s.loading)
  const loadMore = useConversationStore((s) => s.loadMore)
  const hasMore = useConversationStore((s) => s.hasMore)
  const selfId = useAuthStore((s) => s.user?.id ?? '')
  const onlineMap = usePresenceStore((s) => s.online)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return conversations
    return conversations.filter((c) =>
      conversationTitle(c, selfId).toLowerCase().includes(keyword),
    )
  }, [conversations, query, selfId])

  const totalUnread = useMemo(
    () => Object.values(unread).reduce((sum, n) => sum + n, 0),
    [unread],
  )

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="sidebar-header-row">
          <h1 className="sidebar-title">消息</h1>
          <button className="icon-btn" onClick={onNewChat} title="发起会话">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div className="search-box">
          <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            placeholder="搜索会话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      {totalUnread > 0 && (
        <div className="sidebar-summary">
          共 {totalUnread} 条未读
        </div>
      )}

      <div className="conversation-list">
        {filtered.length === 0 && !loading && (
          <div className="list-empty">
            <p>{query ? '没有匹配的会话' : '还没有会话'}</p>
            <p className="list-empty-hint">点右上角 + 发起一个会话</p>
          </div>
        )}

        {filtered.map((conversation) => {
          const title = conversationTitle(conversation, selfId)
          const avatar = conversationAvatar(conversation, selfId)
          const badge = unread[String(conversation.id)] ?? 0
          // 摘要优先用本地拉的预览 —— 后端的 last_message 一直是空的
          const preview = previews[String(conversation.id)]
          const time = preview?.at || conversation.last_message_at || conversation.updated_at
          // 单聊时显示对方的在线状态；群聊没有「对方」可言
          const peerId =
            conversation.type === ConversationType.Single
              ? conversation.member_ids.find((id) => id !== selfId)
              : undefined

          return (
            <button
              key={conversation.id}
              className={`conversation-item ${activeId === conversation.id ? 'is-active' : ''}`}
              onClick={() => onSelect(conversation)}
            >
              <Avatar
                src={avatar}
                name={title}
                size={44}
                online={peerId ? onlineMap[peerId] : undefined}
              />
              <div className="conversation-info">
                <div className="conversation-top">
                  <span className="conversation-name u-truncate">{title}</span>
                  {time > 0 && (
                    <span className="conversation-time">{formatConversationTime(time)}</span>
                  )}
                </div>
                <div className="conversation-bottom">
                  <span className="conversation-preview u-truncate">
                    {preview?.text ?? lastMessagePreview(conversation)}
                  </span>
                  {badge > 0 && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
                </div>
              </div>
            </button>
          )
        })}

        {hasMore && (
          <button className="load-more" onClick={loadMore} disabled={loading}>
            {loading ? '加载中…' : '加载更多'}
          </button>
        )}
      </div>
    </aside>
  )
}
