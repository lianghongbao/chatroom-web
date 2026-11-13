/** 头像 —— 有 URL 用图，无图用昵称首字生成色块。 */
import { useMemo } from 'react'

interface AvatarProps {
  /** 头像图片地址，空则用首字色块。 */
  src?: string
  /** 用于取首字和生成颜色。 */
  name?: string
  /** 边长像素。 */
  size?: number
  /** 在线状态点。传 undefined 则不显示这个点。 */
  online?: boolean
  className?: string
}

/** 由字符串生成稳定的颜色。同一用户每次渲染都是同一个色。 */
function colorFromString(text: string): string {
  const palette = [
    '#6366f1',
    '#8b5cf6',
    '#ec4899',
    '#f43f5e',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#14b8a6',
    '#0ea5e9',
    '#64748b',
  ]
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return palette[hash % palette.length]
}

/** 取昵称首字做占位。中文取一个字，英文取首字母。 */
function initial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return [...trimmed][0].toUpperCase()
}

export function Avatar({ src, name = '', size = 40, online, className = '' }: AvatarProps) {
  const background = useMemo(() => colorFromString(name || '?'), [name])
  const fontSize = Math.round(size * 0.4)

  return (
    <div
      className={`avatar ${className}`}
      style={{ width: size, height: size, fontSize, background }}
    >
      {src ? (
        <img src={src} alt={name} className="avatar-img" onError={(e) => {
          // 图片挂了就退回色块首字
          e.currentTarget.style.display = 'none'
        }} />
      ) : (
        <span className="avatar-initial">{initial(name)}</span>
      )}
      {online !== undefined && (
        <span className={`avatar-status ${online ? 'is-online' : 'is-offline'}`} />
      )}
    </div>
  )
}
