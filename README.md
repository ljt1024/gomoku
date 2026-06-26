# 玄纹棋室 Gomoku Arena

一个基于 React、Vite、Express 和 Socket.IO 的在线五子棋房间应用。玩家可以创建房间、分享邀请链接、实时对弈、申请悔棋、重开一局，并在断线后重新连接到原房间。

## 功能特性

- 15 x 15 五子棋棋盘，黑棋先行，五子连珠获胜
- 房间号创建与加入，支持邀请链接自动带入房间号
- Socket.IO 实时同步棋盘、回合、玩家状态和提示消息
- 双人在线检测，对方离线时暂停落子
- 悔棋申请与对方审批
- 新一局、离开房间、最近落子记录
- 背景音乐与落子音效，支持授权音频文件回退到 Web Audio 循环
- 响应式深色棋室界面

## 技术栈

- React 18
- Vite 5
- Express 4
- Socket.IO 4
- lucide-react

## 环境要求

- Node.js 18+
- npm

## 快速开始

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

开发脚本会同时启动：

- 前端 Vite：`http://localhost:5173`
- Socket.IO/Express 服务：`http://localhost:3001`

打开浏览器访问 `http://localhost:5173`，创建房间后复制邀请链接给另一位玩家即可开始对局。

## 常用命令

```bash
npm run dev      # 同时启动开发后端和 Vite
npm run server   # 只启动 Express/Socket.IO 服务
npm run build    # 构建前端到 dist
npm start        # 启动生产服务，托管 dist 并提供 Socket.IO
npm run smoke    # 运行 Socket.IO 冒烟测试
```

## 冒烟测试

先启动后端服务：

```bash
PORT=3001 npm run server
```

再运行测试：

```bash
npm run smoke
```

测试脚本会模拟两名玩家创建房间、加入房间、落子、申请悔棋、同意悔棋，并验证五子连珠胜负结果。

如果服务不在默认地址，可以指定：

```bash
SMOKE_URL=http://127.0.0.1:5556 npm run smoke
```

## 生产构建与运行

构建前端：

```bash
npm run build
```

启动生产服务：

```bash
npm start
```

生产服务默认监听 `5556` 端口，可通过 `PORT` 修改：

```bash
PORT=3001 npm start
```

生产构建时，前端会读取 `VITE_SOCKET_URL` 作为 Socket.IO 服务地址。如果部署地址不是代码中的默认地址，建议在构建时显式指定：

```bash
VITE_SOCKET_URL=http://YOUR_SERVER_IP:3001 npm run build
PORT=3001 npm start
```

更多部署说明见 [DEPLOY.md](./DEPLOY.md)。

## 背景音乐

应用会优先播放：

```text
public/audio/pipa-yu.mp3
```

请确保该文件是你有权使用的授权音频。如果文件不存在或无法播放，应用会回退到内置的原创 Web Audio 循环。

## 项目结构

```text
.
├── src/
│   ├── App.jsx          # 前端应用、棋盘、房间面板和 Socket.IO 客户端逻辑
│   ├── main.jsx         # React 入口
│   └── styles.css       # 页面样式
├── server/
│   └── index.js         # Express 服务和 Socket.IO 房间/对局逻辑
├── scripts/
│   ├── dev.js           # 同时启动后端和 Vite
│   └── smoke-socket.js  # Socket.IO 冒烟测试
├── public/
│   └── audio/           # 背景音乐资源
├── DEPLOY.md            # 生产部署说明
├── vite.config.js       # Vite 配置
└── package.json
```

## 注意事项

- 房间和对局状态目前保存在服务端内存中，服务重启后会丢失。
- 不建议直接用 PM2 cluster 模式或多进程横向扩容，除非加入 sticky sessions 和共享的 Socket.IO adapter（如 Redis）。
- 如果使用 Nginx 反向代理，需要开启 WebSocket upgrade 头，详见 [DEPLOY.md](./DEPLOY.md)。
