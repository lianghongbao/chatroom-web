/**
 * 群名就地编辑 —— 点名字变输入框，Enter 保存 / Esc 取消。
 *
 * 聊天头部和「群聊信息」面板共用。渲染成什么样由调用方决定
 * （头部是 h2，面板里是 h3），所以这里用 render prop 把内容交出去。
 *
 * 只有群主能改。非群主渲染的就是个纯展示的标题。
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from '../utils/toast'
import * as conversationApi from '../api/conversation'
import type { ConversationInfo } from '../api/conversation'
import { useConversationStore } from '../stores/conversation'
import { errorMessage } from '../utils/errors'

interface GroupNameEditorProps {
  /** 当前会话。 */
  conversation: ConversationInfo
  /** 当前用户 uid。 */
  selfId: string
  /** 输入框的 class —— 不同位置的字号不一样。 */
  inputClassName: string
  /** 展示态的 class。 */
  displayClassName: string
  /** 展示态渲染函数 —— 头部和面板要包的东西不一样。 */
  renderDisplay: (name: string) => React.ReactNode
}

export function GroupNameEditor({
  conversation,
  selfId,
  inputClassName,
  displayClassName,
  renderDisplay,
}: GroupNameEditorProps) {
  const upsert = useConversationStore((s) => s.upsert)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.name)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isOwner = conversation.owner_id === selfId

  // 换会话时把草稿重置 —— 否则给 B 群改名时草稿里还是 A 群的名字。
  useEffect(() => {
    setDraft(conversation.name)
    setEditing(false)
  }, [conversation.id, conversation.name])

  // 进编辑态就聚焦并全选 —— 直接打字，不用先点一下输入框。
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const save = async () => {
    const name = draft.trim()
    if (!name) {
      toast('群名不能为空', 'error')
      setDraft(conversation.name)
      setEditing(false)
      return
    }
    if (name === conversation.name) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      // 只传名字，avatar 留空表示「不改头像」。
      const res = await conversationApi.updateConversation(conversation.id, name)
      upsert(res.conversation)
      toast('群名已更新', 'success')
      setEditing(false)
    } catch (e) {
      toast(errorMessage(e, '改名失败'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={inputClassName}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(conversation.name)
            setEditing(false)
          }
        }}
        maxLength={128}
        disabled={saving}
        aria-label="群名"
      />
    )
  }

  return (
    <span
      className={isOwner ? `${displayClassName} is-editable` : displayClassName}
      onClick={isOwner ? () => setEditing(true) : undefined}
      title={isOwner ? '点击修改群名' : undefined}
      role={isOwner ? 'button' : undefined}
      tabIndex={isOwner ? 0 : undefined}
      onKeyDown={
        isOwner
          ? (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setEditing(true)
              }
            }
          : undefined
      }
    >
      {renderDisplay(conversation.name || '未命名群聊')}
    </span>
  )
}
