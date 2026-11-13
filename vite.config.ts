import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 五个后端服务的本地地址。
// 开发期统一走 proxy：前端用同源的 /api/user、/api/friend 等路径请求，
// 由 vite 转发到对应端口 —— 后端没开 CORS，同源代理最省事。
const BACKEND = {
  user: 'http://localhost:8000',
  friend: 'http://localhost:8001',
  conversation: 'http://localhost:8002',
  message: 'http://localhost:8003',
  gateway: 'http://localhost:8004',
} as const

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/user': { target: BACKEND.user, changeOrigin: true },
      '/api/friend': { target: BACKEND.friend, changeOrigin: true },
      '/api/conversation': { target: BACKEND.conversation, changeOrigin: true },
      '/api/message': { target: BACKEND.message, changeOrigin: true },
      // WS 网关。ws: true 让 vite 把 HTTP 升级请求转成 WebSocket。
      '/ws': { target: BACKEND.gateway, changeOrigin: true, ws: true },
    },
  },
})
