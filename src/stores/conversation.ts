/** 会话列表 + 未读数 store。 */
import { create } from 'zustand'
import * as conversationApi from '../api/conversation'
import * as messageApi from '../api/message'
import type { ConversationInfo } from '../api/conversation'
import { wsClient } from '../api/ws'

interface ConversationState {
  conversations: ConversationInfo[]
  /** 各会话未读数，key 是 conversation id。 */
  unread: Record<string, number>
  /**
   * 各会话的最后一条消息摘要，key 是 conversation id。
   *
   * conversation 服务的 ConversationInfo.last_message 一直是空的
   * （后端没跨服务查 message），所以这里自己从 message 服务拉一次。
   */
  previews: Record<string, { text: string; at: number }>
  loading: boolean
  error: string | null
  hasMore: boolean
  cursor: number
  load: () => Promise<void>
  loadMore: () => Promise<void>
  refreshUnread: () => Promise<void>
  /** 拉每个会话的最后一条消息，用来在列表里显示摘要。 */
  loadPreviews: (conversations: ConversationInfo[]) => Promise<void>
  /** 收到新消息时更新摘要，不用重新拉整个列表。 */
  setPreview: (conversationId: number, text: string, at: number) => void
  clearUnread: (conversationId: number) => void
  /** 会话被创建 / 更新后局部替换，保证列表里的名字和成员资料是最新的。 */
  upsert: (conversation: ConversationInfo) => void
  remove: (conversationId: number) => void
  reset: () => void
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  unread: {},
  previews: {},
  loading: false,
  error: null,
  hasMore: false,
  cursor: 0,

  async load() {
    set({ loading: true, error: null })
    try {
      const res = await conversationApi.listConversations(undefined, 50)
      const conversations = res.conversations ?? []
      set({
        conversations,
        cursor: res.next_cursor,
        hasMore: !!res.next_cursor,
        loading: false,
      })
      get().loadPreviews(conversations)
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : '加载会话失败',
      })
    }
  },

  async loadPreviews(conversations) {
    // 每个会话拉最新一条。列表页要显示摘要，但 conversation 服务不提供
    // last_message —— 只能自己问 message 服务。
    await Promise.all(
      conversations.map(async (conversation) => {
        try {
          const res = await messageApi.listMessages(conversation.id, undefined, 1)
          const last = res.messages?.[0]
          if (!last) return
          set((s) => ({
            previews: {
              ...s.previews,
              [String(conversation.id)]: { text: last.content, at: last.created_at },
            },
          }))
        } catch {
          // 拉不到摘要不影响列表本身
        }
      }),
    )
  },

  async loadMore() {
    const { cursor, hasMore, loading } = get()
    if (!hasMore || loading) return
    set({ loading: true })
    try {
      const res = await conversationApi.listConversations(cursor, 50)
      const existing = get().conversations
      const seen = new Set(existing.map((c) => c.id))
      const merged = [
        ...existing,
        ...(res.conversations ?? []).filter((c) => !seen.has(c.id)),
      ]
      set({
        conversations: merged,
        cursor: res.next_cursor,
        hasMore: !!res.next_cursor,
        loading: false,
      })
      get().loadPreviews(res.conversations ?? [])
    } catch {
      set({ loading: false })
    }
  },

  async refreshUnread() {
    try {
      const res = await messageApi.getUnreadCount()
      set({ unread: res.per_conversation ?? {} })
    } catch {
      // 未读数拉不到不影响主流程
    }
  },

  setPreview(conversationId, text, at) {
    set((s) => ({
      previews: {
        ...s.previews,
        [String(conversationId)]: { text, at },
      },
    }))
  },

  clearUnread(conversationId) {
    const unread = { ...get().unread }
    delete unread[String(conversationId)]
    set({ unread })
  },

  upsert(conversation) {
    const list = get().conversations
    const index = list.findIndex((c) => c.id === conversation.id)
    if (index === -1) {
      set({ conversations: [conversation, ...list] })
      return
    }
    const next = [...list]
    next[index] = conversation
    set({ conversations: next })
  },

  remove(conversationId) {
    set({
      conversations: get().conversations.filter((c) => c.id !== conversationId),
    })
    // 退群 / 解散后别再对这个会话发 resume 帧
    wsClient.untrackResume(conversationId)
  },

  reset() {
    set({
      conversations: [],
      unread: {},
      previews: {},
      cursor: 0,
      hasMore: false,
      error: null,
    })
  },
}))
