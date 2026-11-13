/** 在线状态 store —— 网关推的 presence / online 帧。 */
import { create } from 'zustand'
import { wsClient } from '../api/ws'
import type { OnlineData, PresenceData } from '../api/ws'

interface PresenceState {
  /** uid → 是否在线。 */
  online: Record<string, boolean>
  /** 收到 presence 帧，更新整批成员的状态。 */
  applyPresence: (members: Record<string, boolean>) => void
  /** 收到 online 帧，更新单个用户的状态。 */
  applyOnline: (userId: string, online: boolean) => void
  /** 清空整个 store。 */
  reset: () => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  online: {},

  applyPresence(members) {
    set((s) => ({ online: { ...s.online, ...members } }))
  },

  applyOnline(userId, online) {
    set((s) => ({ online: { ...s.online, [userId]: online } }))
  },

  reset() {
    set({ online: {} })
  },
}))

/**
 * 订阅在线状态帧。
 *
 * presence 是「某个会话里各成员的状态」，online 是「某个人上下线了」。
 * 网关在别人上下线时也会主动推 online 帧。
 */
export function attachPresenceStream(): () => void {
  return wsClient.onFrame((frame) => {
    if (frame.type === 'presence') {
      const data = frame.data as PresenceData
      if (data?.members) {
        usePresenceStore.getState().applyPresence(data.members)
      }
    } else if (frame.type === 'online') {
      const data = frame.data as OnlineData
      if (data?.user_id) {
        usePresenceStore.getState().applyOnline(data.user_id, data.online)
      }
    }
  })
}
