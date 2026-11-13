# chatroom-web

chatroom 的前端。React 19 + TypeScript + Vite，一个进程对接全部五个后端服务。

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:5173 。后端五个服务要先跑起来（端口见下表），
前端通过 vite proxy 转发，不存在跨域问题。

## 后端服务对应关系

| 服务 | 本地端口 | 前端用到的路径前缀 |
|---|---|---|
| `chatroom-user` | 8000 | `/api/user` |
| `chatroom-friend` | 8001 | `/api/friend` |
| `chatroom-conversation` | 8002 | `/api/conversation` |
| `chatroom-message` | 8003 | `/api/message` |
| `chatroom-ws-gateway` | 8004 | `/ws` |

代理规则在 `vite.config.ts`。要连远端环境时改那里的 `BACKEND` 常量即可。

## 功能

- **登录 / 注册** —— 双 token（access 15 分钟 + refresh 7 天）。
  access 过期会自动用 refresh 换新的，刷新请求做了并发去重
  —— refresh token 是一次性的，并发刷新会让后几次全部失败。
- **会话列表** —— 游标分页，未读角标，搜索过滤。
- **聊天** —— WebSocket 实时收消息，历史消息游标分页（往上滚加载更早的）。
- **断线重连补消息** —— 重连成功后发 `resume` 帧，带断线前最后一条消息 id，
  后端把断线期间漏掉的消息补回来。
- **好友** —— 申请 / 同意 / 拒绝 / 删除，好友列表，申请收件箱。
- **会话管理** —— 单聊、群聊，建群、加人、踢人、改群名、转让群主、解散、退群。
- **个人资料** —— 改昵称、头像、改密、登出。
- **在线状态** —— 导航栏底部的小圆点显示 WS 连接状态。

## 目录结构

```
src/
  api/          后端接口封装，一个服务一个文件
    client.ts   fetch 封装：token 注入、401 自动刷新重试、错误处理
    ws.ts       WebSocket 客户端：帧协议、心跳、断线重连、resume
  stores/       zustand store
    auth.ts       登录态、当前用户
    conversation.ts 会话列表、未读数
    message.ts    消息列表、实时消息合并
  components/   组件
  pages/        登录页、好友页、资料页
  styles/       全局变量 + 组件样式
  utils/        时间格式化、错误文案翻译
```

## 两个容易踩的坑

**JSON 字段名是 snake_case。** Kratos v3 走 HTTP 时用的是 `encoding/json` codec
（不是 protojson），字段名取生成代码的 json tag —— `user_id`、`created_at`。
响应体是裸的 proto message，没有 `{code, message, data}` 包装层，业务错误码在 `reason` 字段。

**枚举传数字。** `{"type": 2}` 是群聊，传字符串 `"GROUP"` 后端会 unmarshal 失败。

## 命令

```bash
npm run dev      # 开发服务器
npm run build    # 类型检查 + 生产构建
npm run lint     # oxlint 检查
npm run preview  # 预览生产构建
```
