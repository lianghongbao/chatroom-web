/** 消息气泡。 */
import { Avatar } from './Avatar'
import type { MessageInfo } from '../api/message'
import { MessageType } from '../api/message'
import { formatMessageTime } from '../utils/format'

interface MessageBubbleProps {
  message: MessageInfo
  selfId: string
  /** 头像与昵称只在连续消息的第一条显示。 */
  showHeader: boolean
  /** 乐观气泡 —— 还没落库。 */
  pending?: boolean
  nickname?: string
  avatar?: string
}

export function MessageBubble({
  message,
  selfId,
  showHeader,
  pending,
  nickname,
  avatar,
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
