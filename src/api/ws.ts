/**
 * WS 网关客户端 —— 端口 8004。
 *
 * 握手：GET /ws?token=<JWT>。浏览器 WS 不能自定义 header，所以 token 走 query。
 * 帧格式：{"type": "...", ...}，下行统一是 {"type": "...", "data": {...}}。
 */

import { getAccessToken } from './client'

/** 下行帧类型。 */
export type ServerFrameType =
  | 'chat'
  | 'ping'
  | 'status'
  | 'resume'
  | 'pong'
  | 'message'
  | 'online'
  | 'presence'
  | 'error'
  | 'ack'
  | 'resume_result'

/** 消息帧载荷。 */
export interface MessageData {
  message_id: number
  conversation_id: number
  sender_id: string
  msg_type: number
  content: string
  created_at: number
}

/** ack 帧载荷 —— 消息已落库。 */
export interface AckData {
  message_id: number
  conversation_id: number
  created_at: number
}

/** 在线状态帧载荷。 */
export interface OnlineData {
  user_id: string
  online: boolean
}

/** presence 帧载荷。members 是 uid → 是否在线 的映射（后端是 map[string]bool）。 */
export interface PresenceData {
  members: Record<string, boolean>
}

/** 断线重连补消息的结果。 */
export interface ResumeData {
  conversation_id: number
  count: number
  last_message_id: number
  has_more: boolean
}

/** 下行帧。 */
export interface ServerFrame {
  type: ServerFrameType
  data?: unknown
}

/** 网关地址。开发期走 vite proxy 的 /ws。 */
const WS_BASE = '/ws'

/** 重连退避的间隔序列（毫秒）。 */
const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000]

/** 心跳间隔。网关的 PongWait 默认 60s，30s 一次留足余量。 */
const PING_INTERVAL = 30_000

/** 收到 resume_result 后继续补消息的最大轮次，避免无限循环。 */
const MAX_RESUME_ROUNDS = 20

type FrameHandler = (frame: ServerFrame) => void
type StatusHandler = (status: 'connecting' | 'open' | 'closed') => void

/**
 * WS 连接封装。
 *
 * 断线自动重连（指数退避）；重连成功后对每个活跃会话发 resume 帧补消息。
 */
export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Set<FrameHandler>()
  private statusHandlers = new Set<StatusHandler>()
  private pingTimer: number | null = null
  private reconnectTimer: number | null = null
  private attempt = 0
  private closedByUser = false

  /** 重连后要补消息的会话 id。 */
  private resumeTargets = new Map<number, number>()

  /** 当前连接状态。 */
  status: 'connecting' | 'open' | 'closed' = 'closed'

  /** 订阅下行帧。返回取消订阅函数。 */
  onFrame(handler: FrameHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /** 订阅连接状态变化。 */
  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  private emitStatus(status: 'connecting' | 'open' | 'closed'): void {
    this.status = status
    for (const h of this.statusHandlers) h(status)
  }

  /** 连上（已连接则直接返回）。 */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    const token = getAccessToken()
    if (!token) {
      this.emitStatus('closed')
      return
    }

    this.closedByUser = false
    this.emitStatus('connecting')

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${location.host}${WS_BASE}?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    this.ws = ws

    ws.onopen = () => {
      this.attempt = 0
      this.emitStatus('open')
      this.startPing()
      // 重连后补消息：把每个会话断线前的最后一条 id 发给网关
      for (const [conversationId, lastMessageId] of this.resumeTargets) {
        this.sendResume(conversationId, lastMessageId)
      }
    }

    ws.onmessage = (event) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(event.data as string) as ServerFrame
      } catch {
        return
      }
      for (const h of this.handlers) h(frame)
    }

    ws.onclose = () => {
      this.stopPing()
      this.ws = null
      this.emitStatus('closed')
      if (!this.closedByUser) this.scheduleReconnect()
    }

    ws.onerror = () => {
      // close 事件紧随其后，重连逻辑交给 onclose 处理
      ws.close()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]
    this.attempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = window.setInterval(() => {
      this.sendRaw({ type: 'ping' })
    }, PING_INTERVAL)
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /** 主动断开（登出时用）。断开后不再自动重连。 */
  close(): void {
    this.closedByUser = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopPing()
    this.ws?.close()
    this.ws = null
    this.resumeTargets.clear()
    this.emitStatus('closed')
  }

  private sendRaw(payload: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(payload))
    return true
  }

  /**
   * 记住某会话断线前的最后一条消息 id。
   *
   * 重连成功后用它发 resume 帧，把断线期间漏掉的消息补回来。
   */
  trackForResume(conversationId: number, lastMessageId: number): void {
    // 只前进不后退 —— 乱序到达的旧消息不该把游标拉回去
    const current = this.resumeTargets.get(conversationId)
    if (current !== undefined && current >= lastMessageId) return
    this.resumeTargets.set(conversationId, lastMessageId)
  }

  /** 取消跟踪某个会话（退群 / 解散时）。 */
  untrackResume(conversationId: number): void {
    this.resumeTargets.delete(conversationId)
  }

  /**
   * 发消息。
   *
   * 走 WS 而不是 HTTP：网关收到 chat 帧后转给 message 服务落库并广播，
   * 落库成功才回 ack。
   */
  sendChat(conversationId: number, content: string, msgType = 1): boolean {
    return this.sendRaw({
      type: 'chat',
      conversation_id: conversationId,
      msg_type: msgType,
      content,
    })
  }

  /** 查会话成员的在线状态。 */
  queryConversationStatus(conversationId: number): boolean {
    return this.sendRaw({ type: 'status', conversation_id: conversationId })
  }

  /** 发 resume 帧 —— 断线重连后补消息。 */
  sendResume(conversationId: number, lastMessageId: number): boolean {
    return this.sendRaw({
      type: 'resume',
      conversation_id: conversationId,
      last_message_id: lastMessageId,
    })
  }
}

/** 全局单例 —— 一个浏览器只需要一条 WS 连接。 */
export const wsClient = new WsClient()

/**
 * 消费 resume_result：还有更多就继续发 resume 补。
 *
 * 补消息的轮次上限，避免后端一直 has_more 时把客户端拖进死循环。
 */
export function attachResumeHandler(onResumed: (data: ResumeData) => void): () => void {
  let rounds = 0
  return wsClient.onFrame((frame) => {
    if (frame.type !== 'resume_result') return
    const data = frame.data as ResumeData
    onResumed(data)
    if (data?.has_more && rounds < MAX_RESUME_ROUNDS) {
      rounds += 1
      wsClient.sendResume(data.conversation_id, data.last_message_id)
    } else {
      rounds = 0
    }
  })
}
