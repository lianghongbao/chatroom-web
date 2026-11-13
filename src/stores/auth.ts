/** 登录态 store。access/refresh token 存在 localStorage，用户资料存内存。 */
import { create } from 'zustand'
import * as userApi from '../api/user'
import type { UserInfo } from '../api/user'
import { clearTokens, getAccessToken, setUnauthorizedHandler } from '../api/client'
import { wsClient } from '../api/ws'
import { useConversationStore } from './conversation'
import { useMessageStore } from './message'
import { usePresenceStore } from './presence'

/**
 * 清掉跟当前用户相关的数据。
 *
 * 登出 / 换账号时必须调 —— 不清的话，同一台机器上登另一个账号，
 * 上一个用户的会话列表和聊天记录还留在内存里。
 */
function clearUserData() {
  useConversationStore.getState().reset()
  useMessageStore.getState().reset()
  usePresenceStore.getState().reset()
}

interface AuthState {
  user: UserInfo | null
  loading: boolean
  error: string | null
  /** 初始化中 —— 决定首屏显示骨架还是登录页。 */
  initializing: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, nickname?: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (input: { nickname?: string; avatar?: string }) => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: null,
  initializing: true,

  async login(username, password) {
    set({ loading: true, error: null })
    try {
      await userApi.login(username, password)
      const me = await userApi.getCurrentUser()
      // 换账号时上一个用户的数据必须清掉
      clearUserData()
      set({ user: me, loading: false })
      wsClient.connect()
    } catch (e) {
      const message = e instanceof Error ? e.message : '登录失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  async register(username, password, nickname) {
    set({ loading: true, error: null })
    try {
      await userApi.register(username, password, nickname)
      await userApi.login(username, password)
      const me = await userApi.getCurrentUser()
      clearUserData()
      set({ user: me, loading: false })
      wsClient.connect()
    } catch (e) {
      const message = e instanceof Error ? e.message : '注册失败'
      set({ loading: false, error: message })
      throw e
    }
  },

  async logout() {
    const refresh = localStorage.getItem('chatroom.refresh_token')
    wsClient.close()
    if (refresh) {
      try {
        await userApi.logout(refresh)
      } catch {
        // 后端登出失败也要清本地状态
      }
    }
    clearTokens()
    clearUserData()
    set({ user: null })
  },

  async updateProfile(input) {
    // mask 只列真正要改的字段。
    // 后端对 mask 里的空值直接返 INVALID_ARGUMENT ——
    // 只改昵称时若把 avatar 也列进 mask（值为空），整个请求会被拒。
    const paths = Object.entries(input)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k]) => k)
    if (paths.length === 0) return

    const updated = await userApi.updateCurrentUser({ ...input, update_mask: paths })
    set({ user: updated })
  },

  clearError() {
    set({ error: null })
  },
}))

/**
 * 应用启动时恢复登录态。
 *
 * localStorage 里有 token 就直接拉资料；拉不到（过期 / 失效）就清掉 token 回登录页。
 */
export async function bootstrapAuth(): Promise<void> {
  const token = getAccessToken()
  if (!token) {
    useAuthStore.setState({ initializing: false })
    return
  }
  try {
    const me = await userApi.getCurrentUser()
    useAuthStore.setState({ user: me, initializing: false })
    wsClient.connect()
  } catch {
    clearTokens()
    useAuthStore.setState({ user: null, initializing: false })
  }
}

// token 刷新失败后由 client 回调，把界面切回登录页
setUnauthorizedHandler(() => {
  wsClient.close()
  clearUserData()
  useAuthStore.setState({ user: null })
})
