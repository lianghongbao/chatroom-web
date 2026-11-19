/** 好友页 —— 好友列表 + 申请收件箱。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { toast } from '../utils/toast'
import * as friendApi from '../api/friend'
import type { FriendInfo } from '../api/friend'
import * as userApi from '../api/user'
import type { UserInfo } from '../api/user'
import { ApiError } from '../api/client'
import { errorMessage } from '../utils/errors'
import { formatConversationTime } from '../utils/format'

interface FriendsPageProps {
  /** 点好友时回调 —— 直接开聊。 */
  onStartChat: (friend: FriendInfo) => void
}

export function FriendsPage({ onStartChat }: FriendsPageProps) {
  const [friends, setFriends] = useState<FriendInfo[]>([])
  const [requests, setRequests] = useState<FriendInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'friends' | 'requests'>('friends')
  const [addOpen, setAddOpen] = useState(false)
  const [addTarget, setAddTarget] = useState('')
  const [addMessage, setAddMessage] = useState('')
  /** 按用户名查到的用户。uid 记不住，所以先查再申请。 */
  const [addFound, setAddFound] = useState<UserInfo | null>(null)
  /** 查无此人。 */
  const [addNotFound, setAddNotFound] = useState(false)
  const [addSearching, setAddSearching] = useState(false)
  /**
   * 展开了「⋯」菜单的好友。
   *
   * 好友列表里每一行都摆「发消息 / 删除」两个按钮太吵了 ——
   * 微信、QQ、Telegram 都是「点头像/点整行 = 发消息」，
   * 其余操作收进「⋯」菜单里，鼠标移上去才出现。
   *
   * 存 uid 而不是整行对象：同一好友可能同时出现在「好友」和「申请」两个 tab，
   * 存 uid 才能保证两个 tab 的菜单状态互不干扰。
   */
  const [menuFor, setMenuFor] = useState<string | null>(null)
  /** 待删除的好友 —— 删之前先弹确认。 */
  const [removing, setRemoving] = useState<FriendInfo | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [f, r] = await Promise.all([
        friendApi.listFriends(undefined, 100),
        friendApi.listPendingRequests(undefined, 100),
      ])
      setFriends(f.friends ?? [])
      setRequests(r.requests ?? [])
    } catch (e) {
      toast(errorMessage(e, '加载好友失败'), 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  /**
   * 点菜单外面就收起菜单。
   *
   * 没有这个的话菜单会一直挂着，直到用户点「⋯」自己关掉 —— 挡着别人的头像。
   */
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuFor) return
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuFor(null)
      }
    }
    // Escape 也能关 —— 键盘用户不能只有鼠标一条路。
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuFor(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuFor])

  const handleAccept = async (request: FriendInfo) => {
    try {
      await friendApi.acceptFriend(request.id)
      toast(`已添加 ${request.nickname || '好友'} 为好友`, 'success')
      await loadAll()
    } catch (e) {
      toast(errorMessage(e, '同意失败'), 'error')
    }
  }

  const handleReject = async (request: FriendInfo) => {
    try {
      await friendApi.rejectFriend(request.id)
      toast('已拒绝该申请', 'success')
      await loadAll()
    } catch (e) {
      toast(errorMessage(e, '拒绝失败'), 'error')
    }
  }

  const handleRemove = async (friend: FriendInfo) => {
    try {
      await friendApi.removeFriend(friend.friend_id)
      toast('已删除好友', 'success')
      setRemoving(null)
      await loadAll()
    } catch (e) {
      toast(errorMessage(e, '删除失败'), 'error')
    }
  }

  /** 关弹窗时清掉查找状态，下次打开是干净的。 */
  const closeAdd = useCallback(() => {
    setAddOpen(false)
    setAddTarget('')
    setAddMessage('')
    setAddFound(null)
    setAddNotFound(false)
  }, [])

  /**
   * 查人。uid 是 UUIDv7 字符串，用户记不住 —— 加好友时用用户名或手机号找。
   * 输入全数字 11 位按手机号查，否则按用户名查，用户不用管填的是哪种。
   * 查不到就把状态摆出来，别让用户猜是不是自己输错了。
   */
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const query = addTarget.trim()
    if (!query) {
      toast('请填写对方的用户名或手机号', 'error')
      return
    }
    setAddSearching(true)
    setAddFound(null)
    setAddNotFound(false)
    try {
      const u = await userApi.findUser(query)
      setAddFound(u)
    } catch (e) {
      setAddFound(null)
      // 404 = 没有这个用户名 / 手机号。其它错误（网络 / 401）不当成「查无此人」，
      // 否则用户会以为自己输错了，其实是服务挂了。
      if (e instanceof ApiError && e.status === 404) {
        setAddNotFound(true)
      } else {
        toast(errorMessage(e, '查找失败'), 'error')
      }
    } finally {
      setAddSearching(false)
    }
  }

  const handleApply = async () => {
    if (!addFound) {
      toast('请先查找对方', 'error')
      return
    }
    try {
      await friendApi.applyFriend(addFound.id, addMessage.trim())
      toast('好友申请已发送', 'success')
      closeAdd()
    } catch (e) {
      toast(errorMessage(e, '发送申请失败'), 'error')
    }
  }

  return (
    <div className="friends-page">
      <header className="page-header">
        <h1 className="page-title">好友</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
          添加好友
        </button>
      </header>

      <div className="tabs">
        <button
          className={`tab ${tab === 'friends' ? 'is-active' : ''}`}
          onClick={() => setTab('friends')}
        >
          好友
          {friends.length > 0 && <span className="tab-count">{friends.length}</span>}
        </button>
        <button
          className={`tab ${tab === 'requests' ? 'is-active' : ''}`}
          onClick={() => setTab('requests')}
        >
          申请
          {requests.length > 0 && (
            <span className="tab-count is-alert">{requests.length}</span>
          )}
        </button>
      </div>

      <div className="friends-list">
        {loading && <div className="list-empty">加载中…</div>}

        {!loading && tab === 'friends' && (
          <>
            {friends.length === 0 && (
              <div className="list-empty">
                <p>还没有好友</p>
                <p className="list-empty-hint">点右上角「添加好友」开始</p>
              </div>
            )}
            {friends.map((friend) => (
              <div key={friend.friend_id} className="friend-item">
                {/*
                  整行就是「发消息」——
                  好友列表的主功能是开聊，不是管理，所以主操作应该占满整行可点区域。
                  键盘用户用 Tab 聚焦后按 Enter 也能触发。
                */}
                <button
                  className="friend-main"
                  onClick={() => onStartChat(friend)}
                  title={`与 ${friend.nickname || '好友'} 聊天`}
                >
                  <Avatar src={friend.avatar} name={friend.nickname} size={44} />
                  <div className="friend-info">
                    <span className="friend-name">{friend.nickname || '未知用户'}</span>
                    <span className="friend-meta">
                      好友于 {formatConversationTime(friend.created_at_friend)}
                    </span>
                  </div>
                </button>

                {/*
                  「⋯」收着次要操作。删除是破坏性的，藏在菜单里比摆在行尾安全 ——
                  微信、Telegram、Discord 都是这么做的。
                */}
                <div className="friend-menu-wrap" ref={menuFor === friend.friend_id ? menuRef : undefined}>
                  <button
                    className="icon-btn friend-menu-trigger"
                    onClick={() =>
                      setMenuFor(menuFor === friend.friend_id ? null : friend.friend_id)
                    }
                    aria-label="更多操作"
                    aria-haspopup="menu"
                    aria-expanded={menuFor === friend.friend_id}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>

                  {menuFor === friend.friend_id && (
                    <div className="friend-menu" role="menu">
                      <button
                        className="friend-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null)
                          onStartChat(friend)
                        }}
                      >
                        发消息
                      </button>
                      <button
                        className="friend-menu-item is-danger"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null)
                          setRemoving(friend)
                        }}
                      >
                        删除好友
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {!loading && tab === 'requests' && (
          <>
            {requests.length === 0 && (
              <div className="list-empty">
                <p>没有待处理的申请</p>
              </div>
            )}
            {requests.map((request) => (
              <div key={request.id} className="friend-item">
                <Avatar src={request.avatar} name={request.nickname} size={44} />
                <div className="friend-info">
                  <span className="friend-name">{request.nickname || '未知用户'}</span>
                  {request.message && (
                    <span className="friend-meta friend-message">{request.message}</span>
                  )}
                </div>
                <div className="friend-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => handleAccept(request)}>
                    同意
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleReject(request)}>
                    拒绝
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <Modal
        open={addOpen}
        title="添加好友"
        onClose={closeAdd}
        footer={
          <>
            <button className="btn btn-ghost" onClick={closeAdd}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={handleApply}
              disabled={!addFound}
            >
              发送申请
            </button>
          </>
        }
      >
        <form className="modal-form" onSubmit={handleSearch}>
          <label className="field">
            <span className="field-label">对方用户名或手机号<span className="field-required">*</span></span>
            <input
              type="text"
              value={addTarget}
              onChange={(e) => {
                setAddTarget(e.target.value)
                // 改输入就把上一次的查找结果作废 —— 免得拿旧结果去申请。
                setAddFound(null)
                setAddNotFound(false)
              }}
              placeholder="输入用户名或 11 位手机号"
              autoFocus
            />
          </label>
          <button
            type="submit"
            className="btn btn-ghost btn-sm"
            disabled={addSearching || !addTarget.trim()}
          >
            {addSearching ? '查找中…' : '查找用户'}
          </button>

          {addNotFound && (
            <p className="add-hint add-hint-error">
              没有找到用户「{addTarget.trim()}」，请确认用户名或手机号是否正确。
            </p>
          )}

          {addFound && (
            <div className="add-result">
              <Avatar
                src={addFound.avatar}
                name={addFound.nickname || addFound.username}
                size={40}
              />
              <div className="add-result-info">
                <span className="add-result-name">
                  {addFound.nickname || addFound.username}
                </span>
                <span className="add-result-username">@{addFound.username}</span>
              </div>
            </div>
          )}

          {addFound && (
            <label className="field">
              <span className="field-label">验证消息</span>
              <input
                type="text"
                value={addMessage}
                onChange={(e) => setAddMessage(e.target.value)}
                placeholder="说点什么"
                maxLength={200}
              />
            </label>
          )}
        </form>
      </Modal>

      {/* 删除好友要确认 —— 删了就没了，不能像以前那样一个「删除」按钮直接生效。 */}
      <Modal
        open={removing !== null}
        title="删除好友"
        narrow
        onClose={() => setRemoving(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRemoving(null)}>
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={() => removing && handleRemove(removing)}
            >
              删除
            </button>
          </>
        }
      >
        <p className="confirm-text">
          确定要删除好友「{removing?.nickname || '未知用户'}」吗？
          删除后聊天记录仍会保留，但你们不再是好友了。
        </p>
      </Modal>
    </div>
  )
}
