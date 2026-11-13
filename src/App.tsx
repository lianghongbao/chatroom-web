/** 应用外壳 —— 左侧导航 + 会话列表 + 主区域。 */
import { useCallback, useEffect, useState } from 'react'
import { AuthPage } from './pages/AuthPage'
import { FriendsPage } from './pages/FriendsPage'
import { ProfilePage } from './pages/ProfilePage'
import { ConversationList } from './components/ConversationList'
import { ChatPanel } from './components/ChatPanel'
import { ConversationDetails } from './components/ConversationDetails'
import { NewChatDialog } from './components/NewChatDialog'
import { Avatar } from './components/Avatar'
import { toast } from './utils/toast'
import { useAuthStore, bootstrapAuth } from './stores/auth'
import { useConversationStore } from './stores/conversation'
import { attachMessageStream } from './stores/message'
import { attachPresenceStream } from './stores/presence'
import { attachResumeHandler, wsClient } from './api/ws'
import type { ConversationInfo } from './api/conversation'
import { createConversation, ConversationType } from './api/conversation'
import type { FriendInfo } from './api/friend'

type Tab = 'chat' | 'friends' | 'profile'

export default function App() {
  const user = useAuthStore((s) => s.user)
  const initializing = useAuthStore((s) => s.initializing)
  const logout = useAuthStore((s) => s.logout)

  const conversations = useConversationStore((s) => s.conversations)
  const loadConversations = useConversationStore((s) => s.load)
  const refreshUnread = useConversationStore((s) => s.refreshUnread)

  const [tab, setTab] = useState<Tab>('chat')
  const [activeId, setActiveId] = useState<number | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [presetUserId, setPresetUserId] = useState<string | undefined>()
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('closed')

  // 恢复登录态
  useEffect(() => {
    bootstrapAuth()
  }, [])

  // 订阅 WS 消息流
  useEffect(() => {
    const off = attachMessageStream()
    const offPresence = attachPresenceStream()
    const offStatus = wsClient.onStatus(setWsStatus)
    return () => {
      off()
      offPresence()
      offStatus()
    }
  }, [])

  // 断线重连补消息。
  //
  // 网关收到 resume 帧后**已经把补到的消息以 message 帧推过来了**
  // （见 ws-gateway 的 handleResume），所以这里不用再调 listMessagesSince ——
  // 多调一次不仅浪费，还会把整个历史从 id 0 拉一遍。
  // 这里只负责「还有更多就继续发 resume 拉下一批」。
  useEffect(() => {
    return attachResumeHandler(() => {})
  }, [])

  // 登录后拉会话列表
  useEffect(() => {
    if (!user) return
    loadConversations()
    refreshUnread()
  }, [user, loadConversations, refreshUnread])

  // 定期刷新未读数
  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(refreshUnread, 30_000)
    return () => clearInterval(timer)
  }, [user, refreshUnread])

  // 会话列表变化时保持选中项有效
  useEffect(() => {
    if (activeId !== null && conversations.some((c) => c.id === activeId)) return
    setActiveId(conversations.length > 0 ? conversations[0].id : null)
  }, [conversations, activeId])

  const activeConversation = useCallback(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )

  const handleSelectConversation = (conversation: ConversationInfo) => {
    setTab('chat')
    setActiveId(conversation.id)
  }

  /** 从好友页发起单聊 —— 先建会话再切过去。 */
  const handleStartChatWithFriend = async (friend: FriendInfo) => {
    try {
      const res = await createConversation({
        type: ConversationType.Single,
        member_ids: [friend.friend_id],
      })
      useConversationStore.getState().upsert(res.conversation)
      setTab('chat')
      setActiveId(res.conversation.id)
    } catch (e) {
      toast(e instanceof Error ? e.message : '发起会话失败', 'error')
    }
  }

  const openNewChat = (userId?: string) => {
    setPresetUserId(userId)
    setNewChatOpen(true)
  }

  const handleCreated = (conversationId: number) => {
    setTab('chat')
    setActiveId(conversationId)
  }

  if (initializing) {
    return (
      <div className="app-loading">
        <div className="spinner" />
      </div>
    )
  }

  if (!user) {
    return <AuthPage />
  }

  const conversation = activeConversation()

  return (
    <div className="app-shell">
      <nav className="nav-rail">
        <div className="nav-rail-top">
          <div className="nav-brand">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <button
            className={`nav-btn ${tab === 'chat' ? 'is-active' : ''}`}
            onClick={() => setTab('chat')}
            title="消息"
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <button
            className={`nav-btn ${tab === 'friends' ? 'is-active' : ''}`}
            onClick={() => setTab('friends')}
            title="好友"
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
          </button>
          <button
            className={`nav-btn ${tab === 'profile' ? 'is-active' : ''}`}
            onClick={() => setTab('profile')}
            title="我的"
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M20 21a8 8 0 1 0-16 0" />
            </svg>
          </button>
        </div>

        <div className="nav-rail-bottom">
          <div
            className={`ws-dot ws-${wsStatus}`}
            title={
              wsStatus === 'open'
                ? '实时连接正常'
                : wsStatus === 'connecting'
                  ? '连接中…'
                  : '实时连接已断开'
            }
          />
          <button className="nav-avatar" onClick={() => setTab('profile')} title="我的资料">
            <Avatar src={user.avatar} name={user.nickname || user.username} size={34} />
          </button>
          <button className="nav-btn nav-logout" onClick={() => logout()} title="退出登录">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </nav>

      <main className="app-main">
        {tab === 'chat' && (
          <div className="chat-layout">
            <ConversationList
              activeId={activeId}
              onSelect={handleSelectConversation}
              onNewChat={() => openNewChat()}
            />
            <div className="chat-main">
              {conversation ? (
                <ChatPanel
                  // key 让切换会话时整个面板重新挂载 —— 输入框草稿、滚动位置自然重置
                  key={conversation.id}
                  conversation={conversation}
                  onOpenDetails={() => setDetailsOpen(true)}
                />
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <p className="empty-state-title">选择一个会话</p>
                  <p className="empty-state-hint">或点右上角 + 发起新会话</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'friends' && (
          <FriendsPage onStartChat={handleStartChatWithFriend} />
        )}

        {tab === 'profile' && <ProfilePage />}
      </main>

      {conversation && (
        <ConversationDetails
          conversation={conversation}
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          onClosed={() => {
            setDetailsOpen(false)
            setActiveId(null)
          }}
        />
      )}

      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onCreated={handleCreated}
        presetUserId={presetUserId}
      />
    </div>
  )
}
