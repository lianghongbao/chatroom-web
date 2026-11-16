/** 表情选择面板。 */
import { useMemo, useState } from 'react'

/**
 * 表情分组。
 *
 * 每个分类是若干个「表情项」，一个项就是一个字形串。
 * 带变体选择符的（❤️）和 ZWJ 序列的（👨‍👩‍👧）都算一个项 ——
 * 后端按「一个表情」校验，正文里不能再拼第二个。
 */
interface EmojiGroup {
  /** 分组名，面板上的小标题。 */
  name: string
  /** 分类标识。 */
  key: string
  /** 表情字形列表。 */
  items: string[]
}

const EMOJI_GROUPS: EmojiGroup[] = [
  {
    key: 'smileys',
    name: '笑脸',
    items: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
      '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
      '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞',
      '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫',
      '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
    ],
  },
  {
    key: 'gestures',
    name: '手势',
    items: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙',
      '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️',
      '🖖', '👋', '🤝', '🙏', '💪', '🦾', '✍️', '👏',
      '🙌', '🤲', '🤜', '🤛', '👀', '🧠', '👣', '🫶',
    ],
  },
  {
    key: 'hearts',
    name: '爱心',
    items: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
      '💘', '💝', '💟', '🔥', '✨', '⭐', '🌟', '💫',
    ],
  },
  {
    key: 'objects',
    name: '物品',
    items: [
      '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉',
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓',
      '🎮', '🎲', '🎯', '🎳', '🎤', '🎧', '🎸', '🥁',
      '📱', '💻', '⌨️', '🖥️', '🖨️', '📷', '📹', '🔍',
      '☕', '🍺', '🍻', '🥂', '🍰', '🎂', '🍎', '🍉',
    ],
  },
  {
    key: 'symbols',
    name: '符号',
    items: [
      '✅', '❌', '❗', '❓', '⚠️', '🚫', '💯', '🔴',
      '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🔺',
      '🔻', '🔸', '🔹', '🔶', '🔷', '💤', '💨', '💢',
      '♻️', '🔱', '⚜️', '🔰', '⭕', '🚫', '➕', '➖',
    ],
  },
]

interface EmojiPickerProps {
  /** 选中表情后回调。传的是表情字形本身。 */
  onSelect: (emoji: string) => void
  /** 点面板外面时关闭。 */
  onClose: () => void
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [active, setActive] = useState(EMOJI_GROUPS[0].key)

  const group = useMemo(
    () => EMOJI_GROUPS.find((g) => g.key === active) ?? EMOJI_GROUPS[0],
    [active],
  )

  return (
    <div className="emoji-picker" onMouseLeave={onClose}>
      <div className="emoji-tabs">
        {EMOJI_GROUPS.map((g) => (
          <button
            key={g.key}
            className={`emoji-tab ${g.key === active ? 'is-active' : ''}`}
            onClick={() => setActive(g.key)}
            title={g.name}
            aria-label={g.name}
          >
            {g.items[0]}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {group.items.map((emoji) => (
          <button
            key={emoji}
            className="emoji-item"
            onClick={() => onSelect(emoji)}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
