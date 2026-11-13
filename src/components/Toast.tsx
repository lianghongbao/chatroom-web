/** toast 宿主组件 —— 渲染顶部居中的浮层提示。 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { subscribeToasts, type ToastItem } from '../utils/toast'

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>([])

  useEffect(() => subscribeToasts(setList), [])

  if (!list.length) return null

  return createPortal(
    <div className="toast-host">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>,
    document.body,
  )
}
