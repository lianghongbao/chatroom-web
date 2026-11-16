/**
 * 群聊头部 —— 群头像和群名可以直接就地改。
 *
 * 参考飞书 / Lark 的做法：群名和群头像是「聊天窗口的一部分」，
 * 不是要在「群管理」面板里翻到底才找得到的设置项。用户看到群名就想改群名，
 * 看到群头像就想换群头像 —— 入口就该在那儿。
 *
 * 只有群主能改。别人看到的是纯展示。
 */
import { useEffect, useRef, useState } from 'react'
import { Avatar } from './Avatar'
import { toast } from '../utils/toast'
import * as conversationApi from '../api/conversation'
import * as userApi from '../api/user'
import type { ConversationInfo } from '../api/conversation'
import { useConversationStore } from '../stores/conversation'
import { errorMessage } from '../utils/errors'

interface GroupHeaderEditorProps {
  /** 当前会话。 */
  conversation: ConversationInfo
  /** 当前用户 uid。 */
  selfId: string
  /** 标题区（群名 + 副标题）的渲染由外部决定 —— 这里只管头像和群名的编辑。 */
}

export function GroupHeaderEditor({ conversation, selfId }: GroupHeaderEditorProps) {
  const upsert = useConversationStore((s) => s.upsert)

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(conversation.name)
  const [savingName, setSavingName] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const avatarFileRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const isOwner = conversation.owner_id === selfId

  // 换会话时把草稿重置 —— 否则给 B 群改名时草稿里还是 A 群的名字。
  useEffect(() => {
    setNameDraft(conversation.name)
    setEditingName(false)
  }, [conversation.id, conversation.name])

  // 进编辑态就聚焦并全选 —— 直接打字，不用先点一下输入框。
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [editingName])

  const saveName = async () => {
    const name = nameDraft.trim()
    if (!name) {
      toast('群名不能为空', 'error')
      setNameDraft(conversation.name)
      setEditingName(false)
      return
    }
    if (name === conversation.name) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    try {
      // 只传名字，avatar 留空表示「不改头像」。
      const res = await conversationApi.updateConversation(conversation.id, name)
      upsert(res.conversation)
      toast('群名已更新', 'success')
      setEditingName(false)
    } catch (e) {
      toast(errorMessage(e, '改名失败'), 'error')
    } finally {
      setSavingName(false)
    }
  }

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 重置 input 的值 —— 选同一个文件两次也要能触发 change。
    e.target.value = ''
    if (!file) return

    setUploadingAvatar(true)
    try {
      // 群头像的凭证由 conversation 服务自己签 —— 不走 user 服务。
      const ext = userApi.fileExt(file.name)
      const token = await conversationApi.getGroupAvatarUploadToken(conversation.id, ext)
      // 上传前先按后端给的额度拦一道 —— 别浪费一次直传。
      const tooBig = userApi.checkFileSize(file.size, token.max_size)
      if (tooBig) {
        toast(tooBig, 'error')
        return
      }
      const url = await userApi.uploadToOSS(
        {
          host: token.host,
          fields: token.fields,
          public_url: token.public_url,
          max_size: token.max_size,
        } as userApi.UploadToken,
        file,
      )
      // 只改头像，名字传空串 —— 后端把空串当「不改」。
      const res = await conversationApi.updateConversation(conversation.id, '', url)
      upsert(res.conversation)
      toast('群头像已更新', 'success')
    } catch (err) {
      toast(errorMessage(err, '群头像上传失败'), 'error')
    } finally {
      setUploadingAvatar(false)
    }
  }

  return (
    <>
      {/*
        群头像 + 相机角标 —— 跟个人资料页的顶头像是同一套交互。
        角标明说「点这里能换头像」，不用让用户自己猜头像可不可点。
        非群主看不到角标。
      */}
      <div className="group-avatar-wrap">
        <Avatar
          src={conversation.avatar}
          name={conversation.name}
          size={38}
          onClick={isOwner ? () => avatarFileRef.current?.click() : undefined}
          title={isOwner ? (uploadingAvatar ? '上传中…' : '更换群头像') : undefined}
        />
        {isOwner && (
          <button
            className="group-avatar-badge"
            onClick={() => avatarFileRef.current?.click()}
            disabled={uploadingAvatar}
            title={uploadingAvatar ? '上传中…' : '更换群头像'}
            aria-label="更换群头像"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
        )}
      </div>

      {/* 隐藏的 file input —— 群主点群头像就弹系统选择器。
          非群主压根不渲染这个 input —— 少一个可能被人误触的入口。 */}
      {isOwner && (
        <input
          ref={avatarFileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleAvatarPick}
          disabled={uploadingAvatar}
          hidden
        />
      )}

      {/* 群名：点一下就地编辑。飞书那种「单击变输入框」的交互。 */}
      <div className="chat-header-info">
        {editingName ? (
          <input
            ref={nameInputRef}
            className="chat-title-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                saveName()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setNameDraft(conversation.name)
                setEditingName(false)
              }
            }}
            maxLength={128}
            disabled={savingName}
            aria-label="群名"
          />
        ) : (
          <h2
            className={`chat-title u-truncate ${isOwner ? 'is-editable' : ''}`}
            onClick={isOwner ? () => setEditingName(true) : undefined}
            title={isOwner ? '点击修改群名' : undefined}
          >
            {conversation.name || '未命名群聊'}
          </h2>
        )}
        <p className="chat-subtitle">{conversation.member_count} 名成员</p>
      </div>
    </>
  )
}
