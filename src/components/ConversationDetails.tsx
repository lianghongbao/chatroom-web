/** 会话详情 —— 成员列表、群管理操作。 */
import { useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import { toast } from '../utils/toast'
import * as conversationApi from '../api/conversation'
import * as userApi from '../api/user'
import type { ConversationInfo } from '../api/conversation'
import { ConversationType } from '../api/conversation'
import { useAuthStore } from '../stores/auth'
import { useConversationStore } from '../stores/conversation'
import { errorMessage } from '../utils/errors'

interface ConversationDetailsProps {
  /** 要展示的会话。 */
  conversation: ConversationInfo
  /** 是否展开。 */
  open: boolean
  /** 关闭弹窗。 */
  onClose: () => void
  /** 会话被解散 / 退群后通知外层清掉当前会话。 */
  onClosed: () => void
}

export function ConversationDetails({
  conversation,
  open,
  onClose,
  onClosed,
}: ConversationDetailsProps) {
  const selfId = useAuthStore((s) => s.user?.id ?? '')
  const upsert = useConversationStore((s) => s.upsert)
  const remove = useConversationStore((s) => s.remove)

  const [members, setMembers] = useState<{
    member_ids: string[]
    member_nicknames: string[]
    member_avatars: string[]
  }>({ member_ids: [], member_nicknames: [], member_avatars: [] })
  const [loading, setLoading] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState(conversation.name)
  const [addOpen, setAddOpen] = useState(false)
  const [addTarget, setAddTarget] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferTarget, setTransferTarget] = useState('')

  const isGroup = conversation.type === ConversationType.Group
  const isOwner = conversation.owner_id === selfId

  useEffect(() => {
    if (!open) return
    setNewName(conversation.name)
    setLoading(true)
    // 换会话时先清空 —— 否则弹窗里显示的是上一个会话的成员，
    // 等新请求返回才替换掉，中间那一瞬是错的数据。
    setMembers({ member_ids: [], member_nicknames: [], member_avatars: [] })
    conversationApi
      .listMembers(conversation.id)
      .then(async (res) => {
        setMembers(res)
        // 后端跨服务拉成员资料失败时会降级成空字符串（长度仍对齐），
        // 这时自己批量查一次 user 服务把资料补上。
        const missing = res.member_ids.filter((_, i) => !res.member_nicknames[i])
        if (!missing.length) return
        try {
          const { users } = await userApi.getUsersByIds(missing)
          if (!users?.length) return
          const byId = new Map(users.map((u) => [u.id, u]))
          setMembers((prev) => ({
            ...prev,
            member_nicknames: prev.member_nicknames.map((nick, i) => {
              if (nick) return nick
              return byId.get(prev.member_ids[i])?.nickname ?? ''
            }),
            member_avatars: prev.member_avatars.map((avatar, i) => {
              if (avatar) return avatar
              return byId.get(prev.member_ids[i])?.avatar ?? ''
            }),
          }))
        } catch {
          // 补不上就空着，不影响成员列表本身
        }
      })
      .catch(() => setMembers({ member_ids: [], member_nicknames: [], member_avatars: [] }))
      .finally(() => setLoading(false))
  }, [open, conversation.id, conversation.name])

  const handleRename = async () => {
    const name = newName.trim()
    if (!name) {
      toast('群名不能为空', 'error')
      return
    }
    try {
      const res = await conversationApi.updateConversation(conversation.id, name)
      upsert(res.conversation)
      toast('群名已更新', 'success')
      setRenameOpen(false)
    } catch (e) {
      toast(errorMessage(e, '改名失败'), 'error')
    }
  }

  const handleAddMember = async () => {
    const target = addTarget.trim()
    if (!target) {
      toast('请填写成员 ID', 'error')
      return
    }
    try {
      await conversationApi.addMembers(conversation.id, [target])
      const res = await conversationApi.listMembers(conversation.id)
      setMembers(res)
      toast('已添加成员', 'success')
      setAddOpen(false)
      setAddTarget('')
    } catch (e) {
      toast(errorMessage(e, '添加失败'), 'error')
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    try {
      await conversationApi.removeMember(conversation.id, memberId)
      const res = await conversationApi.listMembers(conversation.id)
      setMembers(res)
      toast('已移出成员', 'success')
    } catch (e) {
      toast(errorMessage(e, '移出失败'), 'error')
    }
  }

  const handleTransfer = async () => {
    const target = transferTarget.trim()
    if (!target) {
      toast('请选择新群主', 'error')
      return
    }
    try {
      const res = await conversationApi.transferOwner(conversation.id, target)
      upsert(res.conversation)
      toast('群主已转让', 'success')
      setTransferOpen(false)
    } catch (e) {
      toast(errorMessage(e, '转让失败'), 'error')
    }
  }

  const handleLeave = async () => {
    try {
      await conversationApi.leaveConversation(conversation.id)
      remove(conversation.id)
      toast('已退出群聊', 'success')
      onClosed()
    } catch (e) {
      toast(errorMessage(e, '退群失败'), 'error')
    }
  }

  const handleDissolve = async () => {
    try {
      await conversationApi.dissolveConversation(conversation.id)
      remove(conversation.id)
      toast('群聊已解散', 'success')
      onClosed()
    } catch (e) {
      toast(errorMessage(e, '解散失败'), 'error')
    }
  }

  return (
    <>
      <Modal open={open} title={isGroup ? '群聊信息' : '会话信息'} onClose={onClose}>
        <div className="details">
          {isGroup && (
            <div className="details-group-header">
              <Avatar name={conversation.name} size={56} />
              <div>
                <h3 className="details-group-name">{conversation.name || '未命名群聊'}</h3>
                <p className="details-group-count">{conversation.member_count} 名成员</p>
              </div>
            </div>
          )}

          <section className="details-section">
            <header className="details-section-header">
              <h4>成员</h4>
              {isGroup && isOwner && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}>
                  添加
                </button>
              )}
            </header>

            {loading ? (
              <p className="details-loading">加载中…</p>
            ) : (
              <ul className="member-list">
                {members.member_ids.map((id, index) => {
                  const nickname = members.member_nicknames[index] || ''
                  const avatar = members.member_avatars[index] || ''
                  const isSelf = id === selfId
                  return (
                    <li key={id} className="member-item">
                      <Avatar src={avatar} name={nickname} size={36} />
                      <div className="member-info">
                        <span className="member-name">
                          {nickname || '未知用户'}
                          {isSelf && <span className="member-self-tag">我</span>}
                          {conversation.owner_id === id && (
                            <span className="member-owner-tag">群主</span>
                          )}
                        </span>
                      </div>
                      {isGroup && isOwner && !isSelf && (
                        <button
                          className="btn btn-ghost btn-sm is-danger"
                          onClick={() => handleRemoveMember(id)}
                        >
                          移出
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {isGroup && (
            <section className="details-section">
              <header className="details-section-header">
                <h4>群管理</h4>
              </header>
              <div className="details-actions">
                {isOwner ? (
                  <>
                    <button className="btn btn-ghost btn-block" onClick={() => setRenameOpen(true)}>
                      修改群名
                    </button>
                    <button
                      className="btn btn-ghost btn-block"
                      onClick={() => setTransferOpen(true)}
                    >
                      转让群主
                    </button>
                    <button className="btn btn-danger btn-block" onClick={handleDissolve}>
                      解散群聊
                    </button>
                  </>
                ) : (
                  <button className="btn btn-ghost btn-block" onClick={handleLeave}>
                    退出群聊
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </Modal>

      <Modal
        open={renameOpen}
        title="修改群名"
        narrow
        onClose={() => setRenameOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRenameOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleRename}>
              保存
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">群名</span>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={128}
            autoFocus
          />
        </label>
      </Modal>

      <Modal
        open={addOpen}
        title="添加成员"
        narrow
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleAddMember}>
              添加
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">成员 ID</span>
          <input
            type="text"
            value={addTarget}
            onChange={(e) => setAddTarget(e.target.value)}
            placeholder="粘贴对方用户 ID"
            autoFocus
          />
        </label>
      </Modal>

      <Modal
        open={transferOpen}
        title="转让群主"
        narrow
        onClose={() => setTransferOpen(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setTransferOpen(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleTransfer}>
              确认转让
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">新群主 ID</span>
          <input
            type="text"
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            placeholder="粘贴新群主的用户 ID"
            autoFocus
          />
        </label>
      </Modal>
    </>
  )
}
