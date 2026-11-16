/**
 * 群头像上传器 —— 头像 + 相机角标，点一下就弹系统选择器。
 *
 * 聊天头部和「群聊信息」面板共用这一个组件：
 * 两处的上传逻辑必须一致（同一个凭证端点、同样的校验），
 * 复制两份迟早会走偏。
 *
 * 只有群主能改。非群主渲染的就是个普通头像，没有角标、没有 file input。
 */
import { useRef, useState } from 'react'
import { Avatar } from './Avatar'
import { toast } from '../utils/toast'
import * as conversationApi from '../api/conversation'
import * as userApi from '../api/user'
import type { ConversationInfo } from '../api/conversation'
import { useConversationStore } from '../stores/conversation'
import { errorMessage } from '../utils/errors'

interface GroupAvatarUploaderProps {
  /** 当前会话。 */
  conversation: ConversationInfo
  /** 当前用户 uid。 */
  selfId: string
  /** 头像边长。 */
  size?: number
  /** 角标大小跟着头像走 —— 大头像配大角标，小头像配小角标。 */
  badgeSize?: number
}

export function GroupAvatarUploader({
  conversation,
  selfId,
  size = 38,
  badgeSize = 18,
}: GroupAvatarUploaderProps) {
  const upsert = useConversationStore((s) => s.upsert)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const isOwner = conversation.owner_id === selfId

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 重置 input 的值 —— 选同一个文件两次也要能触发 change。
    e.target.value = ''
    if (!file) return

    setUploading(true)
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
      setUploading(false)
    }
  }

  return (
    <>
      <div className="group-avatar-wrap">
        <Avatar
          src={conversation.avatar}
          name={conversation.name}
          size={size}
          onClick={isOwner ? () => fileRef.current?.click() : undefined}
          title={isOwner ? (uploading ? '上传中…' : '更换群头像') : undefined}
        />
        {/* 相机角标 —— 明说「点这里能换头像」，别让用户自己猜。 */}
        {isOwner && (
          <button
            className="group-avatar-badge"
            style={{ width: badgeSize, height: badgeSize }}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title={uploading ? '上传中…' : '更换群头像'}
            aria-label="更换群头像"
          >
            <svg
              width={Math.round(badgeSize * 0.66)}
              height={Math.round(badgeSize * 0.66)}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
        )}
      </div>

      {/* 隐藏的 file input。非群主压根不渲染 —— 少一个可能被人误触的入口。 */}
      {isOwner && (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handlePick}
          disabled={uploading}
          hidden
        />
      )}
    </>
  )
}
