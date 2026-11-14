/** 消息气泡。 */
import { Avatar } from './Avatar'
import type { MessageInfo } from '../api/message'
import { MessageType } from '../api/message'
import { formatMessageTime } from '../utils/format'

interface MessageBubbleProps {
  /** 要渲染的消息。 */
  message: MessageInfo
  /** 当前用户 uid，用来判断是不是自己发的。 */
  selfId: string
  /** 头像与昵称只在连续消息的第一条显示。 */
  showHeader: boolean
  /** 乐观气泡 —— 还没落库。 */
  pending?: boolean
  /** 发送者昵称。 */
  nickname?: string
  /** 发送者头像。 */
  avatar?: string
  /** 点头像看对方资料。自己的头像不给点。 */
  onAvatarClick?: () => void
}

export function MessageBubble({
  message,
  selfId,
  showHeader,
  pending,
  nickname,
  avatar,
  onAvatarClick,
}: MessageBubbleProps) {
  const isSelf = message.sender_id === selfId
  const isImage = message.type === MessageType.Image

  return (
    <div className={`message-row ${isSelf ? 'is-self' : 'is-peer'}`}>
      <div className="message-avatar-slot">
        {showHeader && (
          <Avatar
            src={isSelf ? undefined : avatar}
            name={isSelf ? '我' : (nickname ?? '')}
            size={36}
            onClick={isSelf ? undefined : onAvatarClick}
          />
        )}
      </div>

      <div className="message-body">
        {showHeader && !isSelf && (
          <div className="message-sender">{nickname || '未知用户'}</div>
        )}
        <div className={`bubble ${isSelf ? 'bubble-self' : 'bubble-peer'} ${pending ? 'is-pending' : ''}`}>
          {isImage ? (
            <img className="bubble-image" src={message.content} alt="图片消息" />
          ) : (
            <span className="bubble-text">{message.content}</span>
          )}
        </div>
        <div className="message-meta">
          {pending && <span className="message-status">发送中</span>}
          <span className="message-time">{formatMessageTime(message.created_at)}</span>
        </div>
      </div>
    </div>
  )
}
