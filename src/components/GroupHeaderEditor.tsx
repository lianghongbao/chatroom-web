/**
 * 群聊头部 —— 群头像和群名可以直接就地改。
 *
 * 参考飞书 / Lark 的做法：群名和群头像是「聊天窗口的一部分」，
 * 不是要在「群管理」面板里翻到底才找得到的设置项。用户看到群名就想改群名，
 * 看到群头像就想换群头像 —— 入口就该在那儿。
 *
 * 只有群主能改。别人看到的是纯展示。
 *
 * 上传和改名的逻辑在 GroupAvatarUploader / GroupNameEditor 里 ——
 * 「群聊信息」面板共用同一套，两处行为必须一致。
 */
import { GroupAvatarUploader } from './GroupAvatarUploader'
import { GroupNameEditor } from './GroupNameEditor'
import type { ConversationInfo } from '../api/conversation'

interface GroupHeaderEditorProps {
  /** 当前会话。 */
  conversation: ConversationInfo
  /** 当前用户 uid。 */
  selfId: string
}

export function GroupHeaderEditor({ conversation, selfId }: GroupHeaderEditorProps) {
  return (
    <>
      <GroupAvatarUploader conversation={conversation} selfId={selfId} size={38} badgeSize={18} />

      {/* 群名：点一下就地编辑。飞书那种「单击变输入框」的交互。 */}
      <div className="chat-header-info">
        <GroupNameEditor
          conversation={conversation}
          selfId={selfId}
          inputClassName="chat-title-input"
          displayClassName="chat-title u-truncate"
          renderDisplay={(name) => <h2 className="u-truncate">{name}</h2>}
        />
        <p className="chat-subtitle">{conversation.member_count} 名成员</p>
      </div>
    </>
  )
}
