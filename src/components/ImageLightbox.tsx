/** 图片大图查看器。点图放大，点遮罩 / 按 Esc 关闭。 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ImageLightboxProps {
  /** 要放大的图片地址。空字符串表示没打开。 */
  src: string
  /** 关闭回调。 */
  onClose: () => void
}

/**
 * 图片大图查看器。
 *
 * 挂在 body 上（portal）—— 消息列表有 overflow: scroll，
 * 不 portal 的话大图会被列表的滚动容器裁掉。
 */
export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  // Esc 关闭。
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [src, onClose])

  if (!src) return null

  return createPortal(
    <div className="lightbox-overlay" onMouseDown={onClose} role="dialog" aria-modal="true">
      <img
        className="lightbox-image"
        src={src}
        alt="图片"
        // 点图本身也关 —— 用户想的是「看完了，点一下回去」。
        onMouseDown={(e) => e.stopPropagation()}
      />
      <button className="lightbox-close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>,
    document.body,
  )
}
