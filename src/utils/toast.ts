/** toast 的事件总线 —— 组件订阅它来渲染。 */

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

let nextId = 1
const listeners = new Set<(items: ToastItem[]) => void>()
let items: ToastItem[] = []

function emit(): void {
  for (const l of listeners) l([...items])
}

/** 弹一条提示，2.8 秒后自动消失。 */
export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = nextId++
  items = [...items, { id, message, kind }]
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, 2800)
}

/** 订阅提示列表。返回取消订阅函数。 */
export function subscribeToasts(fn: (items: ToastItem[]) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
