/** 模态框 —— 遮罩 + 居中卡片。点遮罩关闭，Esc 也关。 */
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  /** 是否展开。 */
  open: boolean
  /** 标题栏文字。 */
  title: string
  /** 点遮罩或 Esc 时关闭。 */
  onClose: () => void
  children: ReactNode
  /** 底部按钮区。 */
  footer?: ReactNode
  /** 窄一点用于确认框。 */
  narrow?: boolean
}

export function Modal({ open, title, onClose, children, footer, narrow }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal ${narrow ? 'modal-narrow' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
