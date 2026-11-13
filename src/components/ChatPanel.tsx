/** 聊天主面板 —— 消息列表 + 输入框。 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { Avatar } from './Avatar'
import { useMessageStore } from '../stores/message'
import { useAuthStore } from '../stores/auth'
import { useConversationStore } from '../stores/conversation'
import { usePresenceStore } from '../stores/presence'
import { wsClient } from '../api/ws'
import { MessageType, markRead as markReadApi, sendMessage } from '../api/message'
import type { MessageInfo } from '../api/message'
import type { ConversationInfo } from '../api/conversation'
import { ConversationType } from '../api/conversation'
import { conversationAvatar, conversationTitle } from '../utils/conversation'
import { formatDateSeparator, isNewTimeGroup } from '../utils/format'
import { toast } from '../utils/toast'
import { errorMessage } from '../utils/errors'

/**
 * 空列表的共享常量。
 *
 * selector 里返回新数组会让 zustand v5 判定状态一直在变，于是无限重渲染。
 */
const EMPTY_MESSAGES: MessageInfo[] = []

interface ChatPanelProps {
  /** 当前打开的会话。 */
  conversation: ConversationInfo
  /** 点右上角图标打开会话详情。 */
  onOpenDetails: () => void
}

export function ChatPanel({ conversation, onOpenDetails }: ChatPanelProps) {
  const selfId = useAuthStore((s) => s.user?.id ?? '')
  // 空数组用模块级常量 —— 每次 selector 里写 [] 会每次返回新引用，
  // zustand 的 getSnapshot 判定「变了」，于是无限重渲染。
  const messages = useMessageStore((s) => s.byConversation[conversation.id] ?? EMPTY_MESSAGES)
  const pending = useMessageStore((s) => s.pending[conversation.id] ?? EMPTY_MESSAGES)
  const hasMore = useMessageStore((s) => s.hasMore[conversation.id] ?? false)
  const load = useMessageStore((s) => s.load)
  const loadMore = useMessageStore((s) => s.loadMore)
  const addPending = useMessageStore((s) => s.addPending)
  const removePending = useMessageStore((s) => s.removePending)
  const confirm = useMessageStore((s) => s.confirm)
  const clearUnread = useConversationStore((s) => s.clearUnread)
  const setPreview = useConversationStore((s) => s.setPreview)
  const onlineMap = usePresenceStore((s) => s.online)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const title = conversationTitle(conversation, selfId)
  // 单聊里「不是我」的那个成员 —— 在线状态要挂在他身上
  const peerId =
    conversation.type === ConversationType.Single
      ? conversation.member_ids.find((id) => id !== selfId)
      : undefined

  // 成员昵称/头像按下标查 —— 后端保证三个数组与 member_ids 对齐
  const profileOf = (userId: string) => {
    const index = conversation.member_ids.indexOf(userId)
    if (index < 0) return { nickname: '', avatar: '' }
    return {
      nickname: conversation.member_nicknames[index] ?? '',
      avatar: conversation.member_avatars[index] ?? '',
    }
  }

  // 切会话：拉历史 + 清未读 + 问网关要成员在线状态
  useEffect(() => {
    load(conversation.id)
    clearUnread(conversation.id)
    wsClient.queryConversationStatus(conversation.id)
  }, [conversation.id, load, clearUnread])

  // 通知后端清零未读。依赖 messages.length：新消息进来时重新标记。
  useEffect(() => {
    const cid = conversation.id
    markReadApi(cid).catch(() => {
      // 未读数清不掉不影响显示
    })
  }, [conversation.id, messages.length])

  // 收到新消息时滚动到底部
  useLayoutEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages.length, pending.length, atBottom])

  // 滚动位置判断 —— 用户往上翻历史时不强制拉回底部
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setAtBottom(distance < 120)

    // 滚到顶部时加载更早的历史
    if (el.scrollTop < 60 && hasMore) {
      loadMore(conversation.id)
    }
  }

  const handleSend = async () => {
    const content = draft.trim()
    if (!content || sending) return

    setSending(true)
    setDraft('')

    // 先上乐观气泡 —— 网关广播排除发送方，等 ack 才有真实消息落地。
    const tempId = -Date.now()
    addPending(conversation.id, {
      id: tempId,
      conversation_id: conversation.id,
      sender_id: selfId,
      type: MessageType.Text,
      content,
      created_at: Math.floor(Date.now() / 1000),
    })

    try {
      if (wsClient.status === 'open') {
        // 走 WS：网关转发给 message 服务，落库成功才回 ack
        wsClient.sendChat(conversation.id, content, MessageType.Text)
      } else {
        // WS 没连上就走 HTTP 兜底 —— 响应里直接带落库后的消息
        const res = await sendMessage(conversation.id, content, MessageType.Text)
        removePending(conversation.id, tempId)
        confirm(conversation.id, tempId, res.message)
        setPreview(conversation.id, content, res.message.created_at)
      }
    } catch (e) {
      removePending(conversation.id, tempId)
      toast(errorMessage(e, '发送失败'), 'error')
      setDraft(content)
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 消息按时间分组：同一人 5 分钟内的连续消息合并成一块
  const grouped = useMemo(() => {
    const all = [...messages, ...pending]
    return all.map((message, index) => {
      const prev = index > 0 ? all[index - 1] : null
      const showHeader =
        !prev ||
        prev.sender_id !== message.sender_id ||
        isNewTimeGroup(prev.created_at, message.created_at)
      const showDate = !prev || isNewTimeGroup(prev.created_at, message.created_at)
      return { message, showHeader, showDate }
    })
  }, [messages, pending])

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <Avatar
          src={conversationAvatar(conversation, selfId)}
          name={title}
          size={38}
          online={peerId ? onlineMap[peerId] : undefined}
        />
        <div className="chat-header-info">
          <h2 className="chat-title u-truncate">{title}</h2>
          <p className="chat-subtitle">
            {conversation.type === ConversationType.Group
              ? `${conversation.member_count} 名成员`
              : peerId && onlineMap[peerId] !== undefined
                ? onlineMap[peerId]
                  ? '在线'
                  : '离线'
                : '单聊'}
          </p>
        </div>
        <button className="icon-btn" onClick={onOpenDetails} title="会话详情">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </header>

      <div className="message-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="message-list">
          {messages.length === 0 && (
            <div className="list-empty message-empty">
              <p>还没有消息</p>
              <p className="list-empty-hint">发条消息打个招呼吧</p>
            </div>
          )}

          {grouped.map(({ message, showHeader, showDate }) => {
            const profile = profileOf(message.sender_id)
            return (
              <div key={`${message.id}-${message.sender_id}`}>
                {showDate && (
                  <div className="date-separator">{formatDateSeparator(message.created_at)}</div>
                )}
                <MessageBubble
                  message={message}
                  selfId={selfId}
                  showHeader={showHeader}
                  pending={message.id < 0}
                  nickname={profile.nickname}
                  avatar={profile.avatar}
                />
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <footer className="composer">
        <textarea
          className="composer-input"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          className="composer-send"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          title="发送"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </footer>
    </section>
  )
}
