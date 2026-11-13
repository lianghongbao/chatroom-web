/** 发起会话 —— 选好友开单聊，或拉人建群。 */
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import { toast } from '../utils/toast'
import * as friendApi from '../api/friend'
import * as conversationApi from '../api/conversation'
import type { FriendInfo } from '../api/friend'
import { ConversationType } from '../api/conversation'
import { useAuthStore } from '../stores/auth'
import { useConversationStore } from '../stores/conversation'
import { errorMessage } from '../utils/errors'

interface NewChatDialogProps {
  /** 是否展开。 */
  open: boolean
  /** 关闭弹窗。 */
  onClose: () => void
  /** 选好之后把新会话交给外层打开。 */
  onCreated: (conversationId: number) => void
  /** 预选的用户（从好友页点「发消息」进来）。 */
  presetUserId?: string
}

export function NewChatDialog({
  open,
  onClose,
  onCreated,
  presetUserId,
}: NewChatDialogProps) {
  const selfId = useAuthStore((s) => s.user?.id ?? '')
  const upsert = useConversationStore((s) => s.upsert)

  const [mode, setMode] = useState<'single' | 'group'>('single')
  const [friends, setFriends] = useState<FriendInfo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(presetUserId ? [presetUserId] : [])
    setGroupName('')
    setMode('single')
    friendApi
      .listFriends(undefined, 200)
      .then((res) => setFriends(res.friends ?? []))
      .catch(() => setFriends([]))
  }, [open, presetUserId])

  const toggle = (userId: string) => {
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const handleCreate = async () => {
    if (selected.length === 0) {
      toast('请至少选择一位成员', 'error')
      return
    }
    setCreating(true)
    try {
      const res = await conversationApi.createConversation({
        // 单聊由成员集合唯一确定，服务端会并入调用方自己
        type:
          mode === 'group' || selected.length > 1
            ? ConversationType.Group
            : ConversationType.Single,
        member_ids: selected,
        name: mode === 'group' ? groupName.trim() : undefined,
      })
      upsert(res.conversation)
      toast(res.reused ? '已打开已有会话' : '会话已创建', 'success')
      onCreated(res.conversation.id)
      onClose()
    } catch (e) {
      toast(errorMessage(e, '创建会话失败'), 'error')
    } finally {
      setCreating(false)
    }
  }

  const nicknameOf = (friend: FriendInfo) => friend.nickname || '未知用户'

  return (
    <Modal
      open={open}
      title="发起会话"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={creating || selected.length === 0}
          >
            {creating ? '创建中…' : '开始聊天'}
          </button>
        </>
      }
    >
      <div className="new-chat">
        <div className="tabs tabs-compact">
          <button
            className={`tab ${mode === 'single' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('single')
              setSelected(presetUserId ? [presetUserId] : [])
            }}
          >
            单聊
          </button>
          <button
            className={`tab ${mode === 'group' ? 'is-active' : ''}`}
            onClick={() => setMode('group')}
          >
            群聊
          </button>
        </div>

        {mode === 'group' && (
          <label className="field">
            <span className="field-label">群名称</span>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="给群起个名字"
              maxLength={128}
            />
          </label>
        )}

        {friends.length === 0 ? (
          <p className="details-loading">
            还没有好友。先去「好友」页添加一位，再回来发起会话。
          </p>
        ) : (
          <ul className="picker-list">
            {friends
              .filter((f) => f.friend_id !== selfId)
              .map((friend) => {
                const checked = selected.includes(friend.friend_id)
                return (
                  <li key={friend.friend_id}>
                    <button
                      className={`picker-item ${checked ? 'is-selected' : ''}`}
                      onClick={() => toggle(friend.friend_id)}
                    >
                      <span className={`checkbox ${checked ? 'is-checked' : ''}`}>
                        {checked && '✓'}
                      </span>
                      <Avatar src={friend.avatar} name={nicknameOf(friend)} size={32} />
                      <span className="picker-name">{nicknameOf(friend)}</span>
                    </button>
                  </li>
                )
              })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
