/** 消息 store —— 历史消息 + WS 实时消息合并。 */
import { create } from 'zustand'
import * as messageApi from '../api/message'
import type { MessageInfo } from '../api/message'
import { MessageType } from '../api/message'
import { wsClient } from '../api/ws'
import type { AckData, MessageData } from '../api/ws'
import { useConversationStore } from './conversation'

interface MessageState {
  /** 按会话 id 存消息列表，旧的在前。 */
  byConversation: Record<number, MessageInfo[]>
  loading: Record<number, boolean>
  hasMore: Record<number, boolean>
  cursor: Record<number, number>
  /** 发送中的消息（乐观气泡）。 */
  pending: Record<number, MessageInfo[]>

  load: (conversationId: number) => Promise<void>
  loadMore: (conversationId: number) => Promise<void>
  /** WS 推来一条新消息。 */
  receive: (data: MessageData) => void
  addPending: (conversationId: number, message: MessageInfo) => void
  removePending: (conversationId: number, messageId: number) => void
  /** ack 到了 —— 把乐观气泡换成真消息。 */
  settleAck: (conversationId: number, messageId: number, createdAt: number) => void
  /** HTTP 兜底路径 —— 响应里直接带落库后的消息。 */
  confirm: (conversationId: number, messageId: number, confirmed: MessageInfo) => void
  reset: () => void
}

/** 消息按 id 去重。WS 推送和历史拉取可能拿到同一条。 */
function dedupe(messages: MessageInfo[]): MessageInfo[] {
  const seen = new Set<number>()
  const result: MessageInfo[] = []
  for (const m of messages) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    result.push(m)
  }
  return result.sort((a, b) => a.id - b.id)
}

export const useMessageStore = create<MessageState>((set, get) => ({
  byConversation: {},
  loading: {},
  hasMore: {},
  cursor: {},
  pending: {},

  async load(conversationId) {
    set((s) => ({ loading: { ...s.loading, [conversationId]: true } }))
    try {
      const res = await messageApi.listMessages(conversationId, undefined, 30)
      const existing = get().byConversation[conversationId] ?? []
      set((s) => ({
        byConversation: {
          ...s.byConversation,
          [conversationId]: dedupe([...res.messages ?? [], ...existing]),
        },
        hasMore: { ...s.hasMore, [conversationId]: !!res.next_cursor },
        cursor: { ...s.cursor, [conversationId]: res.next_cursor },
        loading: { ...s.loading, [conversationId]: false },
      }))
    } catch {
      set((s) => ({ loading: { ...s.loading, [conversationId]: false } }))
    }
  },

  async loadMore(conversationId) {
    const { cursor, hasMore, loading } = get()
    if (!hasMore[conversationId] || loading[conversationId]) return
    set((s) => ({ loading: { ...s.loading, [conversationId]: true } }))
    try {
      const res = await messageApi.listMessages(conversationId, cursor[conversationId], 30)
      const existing = get().byConversation[conversationId] ?? []
      set((s) => ({
        byConversation: {
          ...s.byConversation,
          [conversationId]: dedupe([...(res.messages ?? []), ...existing]),
        },
        hasMore: { ...s.hasMore, [conversationId]: !!res.next_cursor },
        cursor: { ...s.cursor, [conversationId]: res.next_cursor },
        loading: { ...s.loading, [conversationId]: false },
      }))
    } catch {
      set((s) => ({ loading: { ...s.loading, [conversationId]: false } }))
    }
  },

  receive(data) {
    const cid = data.conversation_id
    const message: MessageInfo = {
      id: data.message_id,
      conversation_id: cid,
      sender_id: data.sender_id,
      // WS 帧里的 msg_type 是裸数字，这里转成枚举类型
      type: data.msg_type as MessageType,
      content: data.content,
      created_at: data.created_at,
    }
    set((s) => {
      const list = s.byConversation[cid] ?? []
      if (list.some((m) => m.id === message.id)) return s
      return {
        byConversation: {
          ...s.byConversation,
          [cid]: [...list, message],
        },
      }
    })
  },

  addPending(conversationId, message) {
    set((s) => ({
      pending: {
        ...s.pending,
        [conversationId]: [...(s.pending[conversationId] ?? []), message],
      },
    }))
  },

  removePending(conversationId, messageId) {
    set((s) => ({
      pending: {
        ...s.pending,
        [conversationId]: (s.pending[conversationId] ?? []).filter(
          (m) => m.id !== messageId,
        ),
      },
    }))
  },

  /**
   * ack 到了 —— 把对应的乐观气泡换成真消息。
   *
   * 网关广播排除发送方，自己发的消息收不到 message 帧，
   * 所以「谁发的」得靠乐观气泡自己记着 —— ack 里没有 sender_id。
   *
   * 取最老的那条乐观气泡：网关按连接顺序处理 chat 帧，ack 也按发送顺序回来，
   * 所以先到的 ack 对应先发的那条。
   */
  settleAck(conversationId, messageId, createdAt) {
    // 先找到对应的乐观气泡 —— set 的回调里拿不到外层的值
    const match = (get().pending[conversationId] ?? []).find((m) => m.id < 0)
    if (!match) return

    set((s) => {
      const list = s.pending[conversationId] ?? []
      const confirmed: MessageInfo = {
        id: messageId,
        conversation_id: conversationId,
        sender_id: match.sender_id,
        type: match.type,
        content: match.content,
        created_at: createdAt,
      }
      const existing = s.byConversation[conversationId] ?? []
      return {
        byConversation: {
          ...s.byConversation,
          [conversationId]: dedupe([...existing, confirmed]),
        },
        pending: {
          ...s.pending,
          [conversationId]: list.filter((m) => m.id !== match.id),
        },
      }
    })
    // 同步会话列表摘要 —— 自己发的消息收不到 message 帧，只能在这里更新
    useConversationStore.getState().setPreview(conversationId, match.content, createdAt)
    // 推进断线补消息的游标 —— 自己发的消息也要计入，
    // 否则重连时 resume 会拿旧游标，把自己发过的消息再补一遍。
    wsClient.trackForResume(conversationId, messageId)
  },

  /**
   * HTTP 兜底路径：响应里直接带落库后的消息，直接替换乐观气泡。
   *
   * messageId 是乐观气泡的临时 id（负数）。
   */
  confirm(conversationId, messageId, confirmed) {
    set((s) => {
      const list = s.byConversation[conversationId] ?? []
      const without = list.filter((m) => m.id !== confirmed.id)
      return {
        byConversation: {
          ...s.byConversation,
          [conversationId]: dedupe([...without, confirmed]),
        },
        pending: {
          ...s.pending,
          [conversationId]: (s.pending[conversationId] ?? []).filter(
            (m) => m.id !== messageId,
          ),
        },
      }
    })
  },

  reset() {
    set({ byConversation: {}, loading: {}, hasMore: {}, cursor: {}, pending: {} })
  },
}))

/**
 * 订阅 WS 消息帧，把推来的消息塞进 store。
 *
 * 同时把最后一条消息 id 记到 wsClient 上 —— 断线重连时用它发 resume 帧补消息。
 */
export function attachMessageStream(): () => void {
  return wsClient.onFrame((frame) => {
    if (frame.type === 'message') {
      const data = frame.data as MessageData
      useMessageStore.getState().receive(data)
      wsClient.trackForResume(data.conversation_id, data.message_id)
      // 同步更新会话列表里的摘要
      useConversationStore
        .getState()
        .setPreview(data.conversation_id, data.content, data.created_at)
    } else if (frame.type === 'ack') {
      // 网关广播时排除发送方（见 ws-gateway 的 BroadcastToMembers），
      // 所以自己发的消息收不到 message 帧 —— ack 是自己这条消息落地的唯一信号。
      const data = frame.data as AckData
      useMessageStore.getState().settleAck(data.conversation_id, data.message_id, data.created_at)
    }
  })
}
