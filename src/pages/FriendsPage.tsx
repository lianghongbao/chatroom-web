/** 好友页 —— 好友列表 + 申请收件箱。 */
import { useCallback, useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Modal } from '../components/Modal'
import { toast } from '../utils/toast'
import * as friendApi from '../api/friend'
import type { FriendInfo } from '../api/friend'
import { errorMessage } from '../utils/errors'
import { formatConversationTime } from '../utils/format'

interface FriendsPageProps {
  /** 点好友「发消息」时回调。 */
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
      await loadAll()
    } catch (e) {
      toast(errorMessage(e, '删除失败'), 'error')
    }
  }

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = addTarget.trim()
    if (!target) {
      toast('请填写对方的用户 ID', 'error')
      return
    }
    try {
      await friendApi.applyFriend(target, addMessage.trim())
      toast('好友申请已发送', 'success')
      setAddOpen(false)
      setAddTarget('')
      setAddMessage('')
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
                <Avatar src={friend.avatar} name={friend.nickname} size={44} />
                <div className="friend-info">
                  <span className="friend-name">{friend.nickname || '未知用户'}</span>
                  <span className="friend-meta">
                    好友于 {formatConversationTime(friend.created_at_friend)}
                  </span>
                </div>
                <div className="friend-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => onStartChat(friend)}>
                    发消息
                  </button>
                  <button className="btn btn-ghost btn-sm is-danger" onClick={() => handleRemove(friend)}>
                    删除
                  </button>
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
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleApply}>
              发送申请
            </button>
          </>
        }
      >
        <form className="modal-form" onSubmit={handleApply}>
          <label className="field">
            <span className="field-label">对方用户 ID</span>
            <input
              type="text"
              value={addTarget}
              onChange={(e) => setAddTarget(e.target.value)}
              placeholder="粘贴对方的用户 ID"
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">验证消息（可选）</span>
            <input
              type="text"
              value={addMessage}
              onChange={(e) => setAddMessage(e.target.value)}
              placeholder="说点什么"
              maxLength={200}
            />
          </label>
        </form>
      </Modal>
    </div>
  )
}
