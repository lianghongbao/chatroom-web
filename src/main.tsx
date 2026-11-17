import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastHost } from './components/Toast'
import { registerImageCache } from './utils/imageCache'
import './styles/global.css'
import './styles/app.css'

// 图片本地缓存靠 Service Worker —— 注册放在最外层，
// 跟 React 树没关系，页面一加载就开始。
registerImageCache()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ToastHost />
  </StrictMode>,
)
